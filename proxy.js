/*
* node-uavtalk-proxy: A UAVTalk protocol proxy, written in node.js.
* By: Myles Grant <myles@mylesgrant.com>
* At: https://github.com/grantmd/node-uavtalk-proxy
*
* UAVTalk spec: http://wiki.openpilot.org/display/Doc/UAVTalk
*/

var config = require('./config').config;

var gcs_connected = false;

var dgram = require('dgram');
var proxy = dgram.createSocket("udp4");
proxy.on("message", function(msg, rinfo){
	//console.log("proxy got: " + msg + " from " + rinfo.address + ":" + rinfo.port);

	console.log(msg);
	if (!gcs_connected && msg[0] == 0x3c){
		gcs_connected = true;
		console.log("GCS connected!");
	}
});
proxy.on("listening", function(){
	var address = proxy.address();
	console.log("proxy listening " + address.address + ":" + address.port);
});
proxy.bind(config.proxy_port);
