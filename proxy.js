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
	if (msg[0] == 0x3c){
		if (!gcs_connected){
			gcs_connected = true;
			console.log("GCS connected!");
		}

		// TODO: Send packet *immediately* to flight device

		// Parse the message into a UAVTalk packet
		var packet = {
			type: msg[1],
			length: msg[2]+lshift(msg[3], 8),
			obj_id: msg[4]+lshift(msg[5], 8)+lshift(msg[6], 16)+lshift(msg[7], 24),
			instance_id: msg[8]+lshift(msg[9], 8),
			data: '',
			checksum: 0
		};

		// Sanity
		if (packet.length > 255) return;

		// Read data up to length
		for (var i = 0; i<packet.length-10; i++){
			var idx = 10+i;
			if (idx > msg.length) break;

			packet.data += lshift(msg[idx], 0*8);
		}

		// Read checksum. Yes, this could be msg.length-1, but let's at least attempt to follow the spec
		packet.checksum = msg[packet.length];

		// TODO: Validate checksum

		//console.log(packet);

		if (uavobjects[packet.obj_id]){
			uavobjects[packet.obj_id].data = packet.data;
			uavobjects[packet.obj_id].last_updated = new Date().getTime();
			console.log("Match!");
		}
		else{
			console.log("NO MATCH! %d", packet.obj_id);
		}
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

	//if (result.object['@'].name != 'GCSTelemetryStats') return;
	var info = {
		name: result.object['@'].name,
		isSettings: result.object['@'].settings == 'true' ? 1 : 0,
		isSingleInst: result.object['@'].singleinstance == 'true' ? 1 : 0,
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
				hash.type = 0;
				break;
			case "int16":
				hash.numBytes = 2;
				hash.type = 1;
				break;
			case "int32":
				hash.numBytes = 4;
				hash.type = 2;
				break;
			case "uint8":
				hash.numBytes = 1;
				hash.type = 3;
				break;
			case "uint16":
				hash.numBytes = 2;
				hash.type = 4;
				break;
			case "uint32":
				hash.numBytes = 4;
				hash.type = 5;
				break;
			case "float":
				hash.numBytes = 4;
				hash.type = 6;
				break;
			case "enum":
				hash.numBytes = 1;
				hash.type = 7;
				break;
		}

		info.fields.push(hash);
	}

	info.fields.sort(fieldTypeLessThan);

	var id = calculateID(info) >> 0 >>> 0; // Calc id, convert to unsigned int: http://ask.metafilter.com/208403/What-kind-of-magic-does-QStringsetNum-do#3005095
	info.id = id;
	//if (info.name == 'GCSTelemetryStats') console.log(info);
	uavobjects[id] = info;
}

function fieldTypeLessThan(a, b){
	return a.numBytes < b.numBytes;
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

		if (info.fields[n].type == 7){ // enum
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
		var hashout = (hash ^ (lshift(hash, 5) + (hash>>>2) + value));
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

// In JS, numbers are rounded to 32 bits when using bitwise shift operations (<<). Use this function to avoid that. Also, possibly faster?
// http://stackoverflow.com/questions/337355/javascript-bitwise-shift-of-long-long-number
function lshift(num, bits) {
	return num * Math.pow(2,bits);
}