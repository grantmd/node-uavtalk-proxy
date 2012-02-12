/*
* node-uavtalk-proxy: A UAVTalk protocol proxy, written in node.js.
* By: Myles Grant <myles@mylesgrant.com>
* At: https://github.com/grantmd/node-uavtalk-proxy
*/

var proxy_port = 9999;

var dgram = require('dgram');
var proxy = dgram.createSocket("udp4");
proxy.on("message", function(msg, rinfo){
	//console.log("proxy got: " + msg + " from " + rinfo.address + ":" + rinfo.port);

	console.log(msg);
});
proxy.on("listening", function(){
	var address = proxy.address();
	console.log("proxy listening " + address.address + ":" + address.port);
});
proxy.bind(proxy_port);
