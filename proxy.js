/*
* node-uavtalk-proxy: A UAVTalk protocol proxy, written in node.js.
* By: Myles Grant <myles@mylesgrant.com>
* At: https://github.com/grantmd/node-uavtalk-proxy
*
* UAVTalk spec: http://wiki.openpilot.org/display/Doc/UAVTalk
* Some code stolen from: http://git.openpilot.org/browse/OpenPilot/ground/uavobjgenerator/uavobjectparser.cpp?hb=true
*/

var config = require('./config').config;

var uavobjects = {};

console.log("Reading object defs...");
var fs = require('fs');
var parser = require('libxml-to-js');
fs.readdir(config.uavobjectdefs, function(err, files){
	if (err) throw err;

	for (var i in files){
		var filename = files[i];
		fs.readFile(config.uavobjectdefs+filename, function(err, data){
			if (err) throw err;

			parser(data, parse_object_def);
		});
	}

	console.log("Object def read complete");
});

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

function parse_object_def(err, result){
	if (err) throw err;
	//console.log(result.object);

	var info = {
		name: result.object['@'].name,
		isSettings: result.object['@'].singleinstance == 'true' ? 1 : 0,
		isSingleInst: result.object['@'].settings == 'true' ? 1 : 0,
		description: result.object.description,
		fields: []
	};

	for (var i in result.object.field){
		var field = result.object.field[i];
		if (field['@']) field = field['@']; // wtf?

		var hash = {
			name: field.name,
			numElements: field.elements ? parseInt(field.elements, 10) : 0,
			type: field.type,
			options: field.options ? field.options.split(',') : []
		};

		switch (hash.type){
			case "int8":
				hash.numBytes = 1;
				break;
			case "int16":
				hash.numBytes = 2;
				break;
			case "int32":
				hash.numBytes = 4;
				break;
			case "uint8":
				hash.numBytes = 1;
				break;
			case "uint16":
				hash.numBytes = 2;
				break;
			case "uint32":
				hash.numBytes = 4;
				break;
			case "float":
				hash.numBytes = 4;
				break;
			case "enum":
				hash.numBytes = 1;
				break;
		}

		info.fields.push(hash);
	}

	info.fields.sort(fieldTypeLessThan);

	var id = calculateID(info);
	info.id = id;
	//console.log(info);
	uavobjects[id] = info;
}

function fieldTypeLessThan(a, b){
	return a.numBytes > b.numBytes;
}

/**
 * Calculate the unique object ID based on the object information.
 * The ID will change if the object definition changes, this is intentional
 * and is used to avoid connecting objects with incompatible configurations.
 * The LSB is set to zero and is reserved for metadata
 */
function calculateID(info){
	// Hash object name
	var hash = updateHash(info.name, 0);

	// Hash object attributes
	hash = updateHash(info.isSettings, hash);
	hash = updateHash(info.isSingleInst, hash);

	// Hash field information
	for (var n = 0; n < info.fields.length; n++){
		hash = updateHash(info.fields[n].name, hash);
		hash = updateHash(info.fields[n].numElements, hash);
		hash = updateHash(info.fields[n].type, hash);

		if (info.fields[n].type == 'enum'){
			var options = info.fields[n].options;
			for (var m = 0; m < options.length; m++){
				hash = updateHash(options[m], hash);
			}
		}
	}

	// Done
	return hash & 0xFFFFFFFE;
}

/**
 * Shift-Add-XOR hash implementation. LSB is set to zero, it is reserved
 * for the ID of the metaobject.
 *
 * http://eternallyconfuzzled.com/tuts/algorithms/jsw_tut_hashing.aspx
 */
function updateHash(value, hash){
	//console.log("Typeof %s is %s", value, typeof(value));
	if (typeof(value) == 'number'){
		var hashout = (hash ^ ((hash<<5) + (hash>>>2) + value));
		//console.log("Hash of %d + %d is: %d", hash, value, hashout);
		return hashout;
	}
	else{
		var hashout = hash;
		//console.log("Hashing %s", value);
		for (var n = 0; n < value.length; n++){
			hashout = updateHash(value.charCodeAt(n), hashout);
			//console.log("Hash of %d: %d is %s", n, value.charCodeAt(n), hashout);
		}

		return hashout;
	}
}