////////////////////////////////////////////////////////////////////////////
// Socket Request Processing

var initSocketServer = function(api, next){
	api.socketServer = {};
	api.socketServer.connections = [];
	api.socketServer.socketDataString = "";
	api.socketServer.numberOfLocalSocketRequests = 0;
	
	////////////////////////////////////////////////////////////////////////////
	// server
	api.socketServer.server = api.net.createServer(function (connection) {
		api.stats.incrament(api, "numberOfSocketRequests");
		api.socketServer.numberOfLocalSocketRequests++;
		
	  	connection.setEncoding("utf8");
	  	connection.type = "socket";
		connection.params = {};
		connection.remoteIP = connection.remoteAddress;
		connection.room = api.configData.defaultSocketRoom;
		connection.messageCount = 0;
		var md5 = api.crypto.createHash('md5');
		var hashBuff = new Buffer(connection.remotePort + connection.remoteAddress + Math.random()).toString('base64');
		md5.update(hashBuff);
		connection.id = md5.digest('hex');
		connection.public = {};
		connection.public.id = connection.id;
		
		api.socketServer.connections.push(connection);
	
	  	connection.on("connect", function () {
	  		api.stats.incrament(api, "numberOfActiveSocketClients");
	    	api.log("socket connection "+connection.remoteIP+" | connected");
			api.socketServer.roomAddMember(api, connection);
			process.nextTick(function(){
				api.socketServer.sendSocketMessage(connection, {welcome: api.configData.socketServerWelcomeMessage, room: connection.room, context: "api"});
			})
	  	});
		
	  	connection.on("data", function (chunk) {
			api.socketServer.socketDataString += chunk.toString('utf8');
			var index, line;
			while((index = api.socketServer.socketDataString.indexOf('\r\n')) > -1) {
				var line = api.socketServer.socketDataString.slice(0, index);
				connection.lastLine = line;
				api.socketServer.socketDataString = api.socketServer.socketDataString.slice(index + 2);
				if(line.length > 0) {
					connection.messageCount++; // incrament at the start of the requset so that responses can be caught in order on the client
					var line = line.replace(/(\r\n|\n|\r)/gm,"");
					var words = line.split(" ");
					if(line.indexOf("\u0004") > -1){ } // trap for break chars; do nothing
			    	else if(words[0] == "quit" || words[0] == "exit" || words[0] == "close" ){
						try{ 
							if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | requesting disconnect", "white");}
							api.socketServer.sendSocketMessage(connection, {status: "Bye!", context: "response"}); 
							connection.end();
						}catch(e){ }
					}else if(words[0] == "paramAdd"){
						var parts = words[1].split("=");
						if(parts[0] != null){
							connection.params[parts[0]] = parts[1];
							api.socketServer.sendSocketMessage(connection, {status: "OK", context: "response"});
						}else{
							api.socketServer.sendSocketMessage(connection, {status: "Cannot set null", context: "response"});
						}
						if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
					}else if(words[0] == "paramDelete"){
						connection.params[words[1]] = null;
						api.socketServer.sendSocketMessage(connection, {status: "OK", context: "response"});
						if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
					}else if(words[0] == "paramView"){
						var q = words[1];
						var params = {}
						params[q] = connection.params[q];
						api.socketServer.sendSocketMessage(connection, {context: "response", params: params});
						if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
					}else if(words[0] == "paramsView"){
						api.socketServer.sendSocketMessage(connection, {context: "response", params: connection.params});
						if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
					}else if(words[0] == "paramsDelete"){
						connection.params = {};
						api.socketServer.sendSocketMessage(connection, {context: "response", status: "OK"});
						if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
					}else if(words[0] == "roomChange"){
						api.socketServer.roomRemoveMember(api, connection, function(){
							connection.room = words[1];
							api.chatRoom.roomAddMember(api, connection);
							api.socketServer.sendSocketMessage(connection, {context: "response", status: "OK", room: connection.room});
							if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
						});
					}else if(words[0] == "roomView"){
						api.chatRoom.socketRoomStatus(api, connection.room, function(roomStatus){
							api.socketServer.sendSocketMessage(connection, {context: "response", status: "OK", room: connection.room, roomStatus: roomStatus});
							if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
						});				
					}else if(words[0] == "say"){
						var message = line.substr(4);
						api.chatRoom.socketRoomBroadcast(api, connection, message);
						api.socketServer.sendSocketMessage(connection, {context: "response", status: "OK"});
						if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line, "grey");}
					}else{
						connection.error = false;
						connection.actionStartTime = new Date().getTime();
						connection.response = {};
						connection.response.context = "response";
						connection.params["action"] = words[0];
						api.processAction(api, connection, connection.messageCount, function(connection, cont){
							var delta = new Date().getTime() - connection.actionStartTime;
							if(api.configData.logRequests){api.log(" > socket request from " + connection.remoteIP + " | "+line + " | responded in "+delta+"ms" , "grey");}
							api.socketServer.respondToSocketClient(connection, cont);
						});
					}
				}
			}
	  	});
		
	  	connection.on("end", function () {
	  		api.socketServer.roomRemoveMember(api, connection, function(){
	  			api.stats.incrament(api, "numberOfActiveSocketClients", -1);
				for(var i in api.socketServer.connections){
					if(api.socketServer.connections[i].id == connection.id){ api.socketServer.connections.splice(i,1); }
				}
				try{ connection.end(); }catch(e){
					//
				}
				if(api.configData.logRequests){api.log(" > socket connection " + connection.remoteIP + " disconnected", "white");}
	  		});
	  	});
		
		connection.on("error", function(e){
			api.log("socket error: " + e, "red");
			connection.end();
		});
	});
	
	////////////////////////////////////////////////////////////////////////////
	// action response helper
	api.socketServer.respondToSocketClient = function(connection, cont){
		if(cont != false)
		{
			if(connection.error == false){
				connection.response.error = connection.error;
				if(connection.response == {}){
					connection.response = {status: "OK"};
				}
				api.socketServer.sendSocketMessage(connection, connection.response);
			}else{
				if(connection.response.error == null){
					connection.response.error = connection.error;
				}
				api.socketServer.sendSocketMessage(connection, connection.response);
			}
		}
	}
	
	////////////////////////////////////////////////////////////////////////////
	//message helper
	api.socketServer.sendSocketMessage = function(connection, message){
		try{
			if(connection.respondingTo != null){
				message.messageCount = connection.respondingTo;
				connection.respondingTo = null;
			}else{
				message.messageCount = connection.messageCount;
			}
			connection.write(JSON.stringify(message) + "\r\n"); 
		}catch(e){
			api.log("socket write error: "+e, "red");
		}
	}
	
	////////////////////////////////////////////////////////////////////////////
	// listen
	api.socketServer.server.on("error", function(e){
		api.log("Cannot start socket server @ port " + api.configData.socketServerPort + "; Exiting.", ["red", "bold"]);
		api.log(e);
		process.exit();
	});
	
	api.socketServer.server.listen(api.configData.socketServerPort, "0.0.0.0", function(){
		next();
	});
}

/////////////////////////////////////////////////////////////////////
// exports
exports.initSocketServer = initSocketServer;