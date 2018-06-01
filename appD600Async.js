// Copyright 2017,2018 Axiomware Systems Inc. 
//
// Licensed under the MIT license <LICENSE-MIT or 
// http://opensource.org/licenses/MIT>. This file may not be copied, 
// modified, or distributed except according to those terms.
//

//Add external modules dependencies
var netrunr = require('netrunr-gapi-async');
var chalk = require('chalk');
var figlet = require('figlet');
var fs = require('fs');
var CLI = require('clui');
var myCLUI = require('./lib/lib-clui-utils.js');
var myUtils = require('./lib/lib-generic-utils.js');
var BLEdev = require('./lib/lib-BLEdevice-utils.js');

//Gobal variables
const gapiMain = new netrunr('');                       //Create a Netrunr gateway instance
const gwArray = [];                                     //Object per gateway
var exitFlag = false;                                   //set flag when exiting
var dataFileHandle = null;                              //Open file for storing adv data , append to existing file
var dataFileWriteHeader = false;                        //Keep track of header writing, only write if new file
var statusList = new CLI.Spinner('Scanning ...');       //UI widget to show busy operation

//General Configuration
var userConfig = {
    scanParameters: {
        'period': 1,    // seconds of advertising scan
        'active': 1,      // 1-> active scan, 0-> passive scan
    },
    connectionParameters: {
        'interval_min': 16, // x1.25ms - Connection intervalk min
        'interval_max': 80, // x1.25ms - Connection interval max
        'latency': 0,       // Salve latency
        'timeout': 500,      // x10ms - Supervision timeout
    },
    showDevSelectUIFlag: true, //Keep track of displaying device selection menu
    devSelection: {}, //CLI return value with device delection
    devSelectionFlag: false, //true after devSelection is complete
    selectedDeviceList: {},//collect all devices that were selected by user
    devStatList: {},//0->unconnected, 1->in connection process 2-> connected
    reconnectFlag: true,//reconnect to any device in the selected list if found again
    D600ScanMode: 0, //0-> single scan and 1-> continous scan
}

//Global to capture most variables that are related to gateway
function multiGW(user, pwd, gwid) {
    this.user = user;
    this.pwd = pwd;
    this.gwid = gwid;
    this.gapiAsync = new netrunr('');
    this.advDeviceList = {};//collect all devices that advertise over a period
    this.connectedDeviceList = {};//collect all connected devices
    this.scanComplete = false;
    this.IndicationData = {};
}

var D600GattData = {
    services: [
        {
            uuid: '0f18', //Service UUID for Battery state
            characteristics: [{ uuid: '192a', name: 'Battery Service', enable: false }], //'001b' (read/notify)
        },
        {
            uuid: 'f03c155f53d7b1acef4ef696b701b56c', //Service UUID for humidity
            characteristics: [
                { uuid: 'a620150bfc5f78ba134671d8b8813ece', name: 'Scan Data', enable: false }, //'0030' (read/Indicate)
                { uuid: 'ba49c41f8e4713814746a0bc64233a83', name: 'Scan Control', enable: false }, //'0030' (write)
                { uuid: '373c93921f591da87e4c1218c24b337c', name: 'CCID Status', enable: false }, //'0030' (read/Indicate)
                { uuid: 'c09bcf780a0577bab140d6edfde9ac91', name: 'CCID - PC to RDR', enable: false }, //'0030' (write)
                { uuid: '5abd46ae724a40bf1a4c55b8752dcab4', name: 'CCID - RDR to PC', enable: false }//(read)
            ],
        },
        {
            uuid: 'ca88c58fd616fd9a224ec7f7c985437a', //Config service
            characteristics: [{ uuid: 'ce738dd2c771a8a0b24b6e3372fc5412', name: 'D600 Config', enable: false }], //'001b' (read/write)
        },
    ]
}

var devD600 = new BLEdev(userConfig.connectionParameters, D600GattData);

//Used to monitor for ctrl-c and exit program
process.stdin.resume();//so the program will not close instantly
process.on("SIGINT", function () {
    axShutdown(3, "Received Ctrl-C - shutting down.. please wait");
});

//On exit handler
process.on('exit', function () {
    console.log('Goodbye!');
});

// Ensure any unhandled promise rejections get logged.
process.on('unhandledRejection', err => {
    console.log("Unhandled promise rejection - shutting down.. " + JSON.stringify(err, Object.getOwnPropertyNames(err)));
    process.exit();
})

//Application start
console.log(chalk.green.bold(figlet.textSync('NETRUNR B24C/E', { horizontalLayout: 'default' })));
console.log(chalk.green.bold('Socket Mobile D600 NFC Scanner Example (Async version)'));
console.log(chalk.red.bold('Press Ctrl-C to exit'));
main(); // Call main function



/**
 * Main program entry point
 * 
 */
async function main() {
    let ret;
    try {
        let cred = await myCLUI.getCredentials();//get user credentials (CLI)
        try {
            ret = await gapiMain.auth(cred);//try auth - if JWT token is ok, this will work
        }
        catch (err) { //otherwise use login - don't use logout when exiting. Logout will invalidate the current token
            ret = await gapiMain.login(cred);//login
        }

        let gwidList = await myCLUI.selectSingleGateway(ret.gwid);//get gateway Selection (CLI)
        if (!gwidList) {
            await axShutdown(3, 'No Gateways Selected. Shutting down...');//Exit program 
        }

        userConfig.scanParameters = await myCLUI.getScanPeriodType();//get scan parameters 

        userConfig.reconnectFlag = await myCLUI.getReconnectOption();//reconnect to device if true

        userConfig.D600ScanMode = await myCLUI.getD600ScanMode();//get D600 scan mode (single scan or continous)

        for (let i = 0; i < gwidList.length; i++) {
            gwArray[i] = new multiGW(cred.user, cred.pwd, gwidList[i]);//create an instance of netrunr object for each gateway
            mainLogin(gwArray[i]);
        }

    } catch (err) {
        await axShutdown(3, 'Error! Exiting... ' + JSON.stringify(err, Object.getOwnPropertyNames(err)));//Error - exit
    }
}

/**
 * Create a connection to each gateway + start scan
 * 
 * @param {object} gwObj - Gateway object
 */
async function mainLogin(gwObj) {
    try {
        await gwObj.gapiAsync.auth({ 'user': gwObj.user, 'pwd': gwObj.pwd });           //Use Auth, not login

        gwObj.gapiAsync.config({ 'gwid': gwObj.gwid });                                 //select gateway (CLI)

        await gwObj.gapiAsync.open({});                                                 //open connection to gateway

        let ver = await gwObj.gapiAsync.version(5000);                                //Check gateway version - if gateway is not online(err), exit 
        //console.log(JSON.stringify(ver))

        let cdev = await gwObj.gapiAsync.show({});//list all devices connected to gateway
        //console.log("Connected devices : " + JSON.stringify(cdev))
        if (cdev.nodes.length > 0) {
            await gwObj.gapiAsync.disconnect({ did: '*' }); //disconnect any connected devices
        }

        gwObj.gapiAsync.event({ 'did': '*' }, (robj) => { myGatewayEventHandler(gwObj, robj) }, null);           //Attach event handlers
        gwObj.gapiAsync.report({ 'did': '*' }, (robj) => { myGatewayReportHandler(gwObj, robj) }, null);         //Attach report handlers

        await axScanForBLEdev(gwObj, userConfig.scanParameters.active, userConfig.scanParameters.period);//scan for BLE devices
    } catch (err) {
        await axShutdownGW(gwObj, 3, 'Error! Exiting... ' + JSON.stringify(err, Object.getOwnPropertyNames(err)));//Error - exit gateway
    }
}

/**
 * Scan for BLE devices and generate "scan complete" event at the end of scan
 *
 * @param {object} gwObj - Gateway object
 * @param {number} scanMode - Scan mode  1-> active, 0-> passive
 * @param {number} scanPeriod - Scan period in seconds
 */
async function axScanForBLEdev(gwObj, scanMode, scanPeriod) {
    userConfig.devSelectionFlag = false;
    gwObj.scanComplete = false;
    gwObj.advDeviceList = {};//Clear list
    if (!exitFlag) {
        if (userConfig.showDevSelectUIFlag) {
            statusList.start();
            statusList.message('Scanning ...');
        }
        try {
            let ret = await gwObj.gapiAsync.list({ 'active': scanMode, 'period': scanPeriod });
        } catch (err) {
            statusList.stop();
        }
    }
};


/**
 * Connect to all devices in the list
 * This call is used to apply the configuration data (connection parameters) to all devices in this
 * list. It is best call this function will all devices of the same type
 *
 * @param {object} gwObj - Gateway object
 * @param {object []} nodeList -  BLE device ID List
 * @param {object} configData - Configuration data of the object
 */
async function axConnectToBLEdevice(gwObj, nodeList, devObject) {

    for (let key in nodeList) {
        let iobj = devObject.getConnectionParameters(nodeList[key].did, nodeList[key].dtype);
        if (userConfig.devStatList[nodeList[key].did] == 0) {
            try {
                userConfig.devStatList[nodeList[key].did] = 1;
                let devBLE = await gwObj.gapiAsync.connect(iobj);//Connect to device
                userConfig.devStatList[nodeList[key].did] = 2;
                //gwObj.connectedDeviceList[iobj.did] = nodeList[key];//update the list of connected devices
                gwObj.connectedDeviceList[iobj.did] = { name: "", batt: 0 };//update the list of connected devices
            } catch (err) {
                userConfig.devStatList[nodeList[key].did] = 0;
                console.log('Connection fail... ' + JSON.stringify(err, Object.getOwnPropertyNames(err)));
            }
        }

    }

    await myUtils.sleep(1000); // sleep for 1000 ms
}



/**
 * Pair to all devices in the list
 * This call is used to apply the configuration data (connection parameters) to all devices in this
 * list. It is best call this function will all devices of the same type
 *
 * @param {object} gwObj - Gateway object
 * @param {object []} nodeList -  BLE device ID List
 * @param {object} configData - Configuration data of the object
 */
async function axConfigBLEdevice(gwObj, nodeList, devObject) {
    for (let i = 0; i < nodeList.length; i++) {
        await axPairDev(gwObj, nodeList[i].did);
    }
    for (let i = 0; i < nodeList.length; i++) {
        axConfigDev(gwObj, nodeList[i].did);
    }
}

/**
 * Pair to all devices in the list
 * This call is used to apply the configuration data (connection parameters) to all devices in this
 * list. It is best call this function will all devices of the same type
 *
 * @param {object} gwObj - Gateway object
 * @param {object []} nodeList -  BLE device ID List
 * @param {object} configData - Configuration data of the object
 */
async function axPairDev(gwObj, did) {
    var iobj = {
        "did": did,
        "op": 1,
        "bonding": 1,
        "mitm": 0,
        "secure": 0,
        "oob": 0,
        'init': 0x01,
        'resp': 0x01
    };
    if (gwObj.connectedDeviceList.hasOwnProperty(did)) {//check if the device is in the connected list 
        try {
            await gwObj.gapiAsync.pair(iobj);//Pair
            console.log('Pair ok:[' + myUtils.addrDisplaySwapEndianness(did) + ']');
        } catch (err) {
            console.log('Pair: retry:[' + myUtils.addrDisplaySwapEndianness(did) + ']' + JSON.stringify(err, Object.getOwnPropertyNames(err)));
            await myUtils.sleep(500); // sleep for 500 ms
            await axPairDev(gwObj, did);
        }
    }
}

/**
 * Pair to all devices in the list
 * This call is used to apply the configuration data (connection parameters) to all devices in this
 * list. It is best call this function will all devices of the same type
 *
 * @param {object} gwObj - Gateway object
 * @param {object []} nodeList -  BLE device ID List
 * @param {object} configData - Configuration data of the object
 */
async function axConfigDev(gwObj, did) {

    if (gwObj.connectedDeviceList.hasOwnProperty(did)) {//check if the device is in the connected list 
        try {
            let battState = await gwObj.gapiAsync.read({ did: did, ch: '001a' });//Enable RFID scanner mode
            gwObj.connectedDeviceList[did].batt = GenericBatteryLevelSensor(battState.value).battery;
            console.log('Battery:[' + myUtils.addrDisplaySwapEndianness(did) + '][' + gwObj.connectedDeviceList[did].batt + '%]');
            await gwObj.gapiAsync.write({ did: did, ch: '003f', value: '029f' });//Wink LED
            let devName = await gwObj.gapiAsync.read({ did: did, ch: '0006' });//Enable RFID scanner mode
            let devNameStr = new Buffer(devName.value, 'hex').toString('utf8');
            gwObj.connectedDeviceList[did].name = devNameStr;//update name
            await gwObj.gapiAsync.write({ did: did, ch: '003f', value: '03ae07' });//Enable RFID scanner mode
            if (userConfig.D600ScanMode == 1)
                await gwObj.gapiAsync.write({ did: did, ch: '003f', value: '02a3' });//Enable RFID single or cont scan mode
            await gwObj.gapiAsync.subscribe({ did: did, ch: '0032', notify: 0 });//Enable Indication
            console.log('Config ok:[' + myUtils.addrDisplaySwapEndianness(did) + ']');
            console.log('D600 Ready to Scan[' + myUtils.addrDisplaySwapEndianness(did) + ']');
        } catch (err) {
            console.log('Config: error:[' + myUtils.addrDisplaySwapEndianness(did) + ']' + JSON.stringify(err, Object.getOwnPropertyNames(err)));
        }
    }
}

/**
 * Unpair to all devices in the list
 * This call is used to apply the configuration data (connection parameters) to all devices in this
 * list. It is best call this function will all devices of the same type
 *
 * @param {object} gwObj - Gateway object
 * @param {object []} nodeList -  BLE device ID List
 * @param {object} configData - Configuration data of the object
 */
async function axUnpairBLEdevice(gwObj, did) {
    try {
        await gwObj.gapiAsync.pair({ did: did, op: 0 });//Unpair
    } catch (err) {
        console.log('Unpair error: ', + JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
};

/**
 * Stop scan
 * This call is used to apply the configuration data (connection parameters) to all devices in this
 * list. It is best call this function will all devices of the same type
 *
 * @param {object} gwObj - Gateway object
 * @param {object []} nodeList -  BLE device ID List
 * @param {object} configData - Configuration data of the object
 */
async function axScanStop(gwObj) {
    try {
        await gwObj.gapiAsync.list({ 'active': userConfig.scanParameters.active, 'period': 0 });//stop scan
    } catch (err) {
        console.log('Scan stop err: ', + JSON.stringify(err, Object.getOwnPropertyNames(err)));
    }
};

/**
 * Get device list to support reconnection
 *
 * @param {object} gwObj - Gateway object
 * @param {object} iobj - Notification object
 */
function axGetDeviceListForReconnect(gwObj, advDeviceList, selectedDeviceList) {
    var dev = [];

    if (userConfig.reconnectFlag) {
        for (var key in advDeviceList) {
            if (selectedDeviceList.hasOwnProperty(key)) {
                dev.push({ type: 0, did: advDeviceList[key].did, dtype: advDeviceList[key].dt, name: advDeviceList[key].name, adv: advDeviceList[key].adv, rsp: advDeviceList[key].rsp })
            }
        }
    }
    return { type: -1, deviceList: dev };
}


/**
 * Event handler (for scan complete, disconnection, etc events)
 *
 * @param {object} gwObj - Gateway object
 * @param {Object} iobj - Event handler object - see API docs
 */
async function myGatewayEventHandler(gwObj, iobj) {
    let dev = [];
    switch (iobj.event) {
        case 1: //disconnect event
            console.log('[' + myUtils.getCurrentDateTime() + ']Device disconnect event' + JSON.stringify(iobj, null, 0));
            if (userConfig.devStatList.hasOwnProperty(iobj.node))
                userConfig.devStatList[iobj.node] = 0;
            if (gwObj.connectedDeviceList.hasOwnProperty(iobj.node))
                delete gwObj.connectedDeviceList[iobj.node];
            break;
        case 19: //Encryption change
            console.log('Encryption change' + JSON.stringify(iobj, null, 0));
            if (iobj.subcode != 0) {
                //console.log('Encryption change running' + JSON.stringify(iobj, null, 0));
                await axScanStop(gwObj);//stop scan
                await myUtils.sleep(1000); // sleep for 200 ms
                await axUnpairBLEdevice(gwObj, iobj.node);
                await axScanForBLEdev(gwObj, userConfig.scanParameters.active, 1);//scan for BLE devices
            }
            break;
        case 39://Scan complete event
            statusList.stop();
            //console.log('[' + myUtils.getCurrentDateTime() + ']Scan complete' + JSON.stringify(iobj, null, 0));
            //axPrintAdvListScreen(gwObj.advDeviceList);//Print data to screen 

            gwObj.scanComplete = true;
            if (!exitFlag) {//Do not process events when in exit mode
                if (userConfig.showDevSelectUIFlag) {
                    dev = await myCLUI.selectBLEdeviceMultiGW(gwObj.advDeviceList);
                    userConfig.devSelection = dev;
                    userConfig.devSelectionFlag = true;
                    //dev = await axCollectDevConnectionList(gwObj);
                    await myUtils.sleep(200); // sleep for 200 ms
                }
                else {
                    dev = axGetDeviceListForReconnect(gwObj, gwObj.advDeviceList, userConfig.selectedDeviceList);
                }
                if (dev.type == 2)
                    await axShutdown(3, 'Shutting down.. please wait ');
                else if (dev.type == 1)
                    await axScanForBLEdev(gwObj, userConfig.scanParameters.active, userConfig.scanParameters.period);//scan for BLE devices
                else {
                    userConfig.showDevSelectUIFlag = false;
                    if (dev.type == 0) {
                        axUpdateAdvNodeList(userConfig.selectedDeviceList, dev.deviceList);//update list
                        for (let key in userConfig.selectedDeviceList) {
                            userConfig.devStatList[key] = 0;//set status of all devices as unconnected
                        }
                    }
                    //console.log('DEV  STAT   ' + JSON.stringify(dev))
                    if (dev.deviceList.length > 0) {
                        let D600NodeList = dev.deviceList.filter(axAdvMatchD600);//Filter adv for sensirion
                        //console.log('CONN start' + JSON.stringify(dev))
                        await axConnectToBLEdevice(gwObj, D600NodeList, devD600);
                        //console.log('CONF start' + JSON.stringify(dev))
                        await axConfigBLEdevice(gwObj, D600NodeList, devD600);
                        //console.log('CONF Done' + JSON.stringify(dev))
                    }
                    await axScanForBLEdev(gwObj, userConfig.scanParameters.active, 1);//scan for BLE devices
                }
            }
            break;
        default:
            console.log('Other unhandled event [' + iobj.event + ']');
    }
}



/**
 * Report handler (for advertisement data, notification and indication events)
 *
 * @param {object} gwObj - Gateway object
 * @param {Object} iobj - Report handler object - see API docs 
 */
function myGatewayReportHandler(gwObj, iobj) {
    switch (iobj.report) {
        case 1://adv report
            //console.log('Adv report: ' + JSON.stringify(iobj, null, 0))

            var advArray = axAddGWIDInfo(gwObj, iobj.nodes); //add gateway info

            var advArrayMap = advArray.map(axAdvExtractData);//Extract data

            var advArrayD600 = advArrayMap.filter(axAdvMatchD600);//Filter adv for sensirion
            axUpdateAdvNodeList(gwObj.advDeviceList, advArrayD600);//update list
            statusList.message('Scanning ...  Found ' + Object.keys(gwObj.advDeviceList).length + ' Device(s)');
            break;

        case 26://Indication report
            //console.log('Indication received: ' + JSON.stringify(iobj, null, 0))
            //axNotificationHandler(gwObj, iobj)
            axIndicationHandler(gwObj, iobj);
            break;


        case 27://Notification report
            //console.log('Notification received: ' + JSON.stringify(iobj, null, 0))
            //axNotificationHandler(gwObj, iobj)
            break;
        default:
            console.log('(Other report) ' + JSON.stringify(iobj, null, 0))
    }
}

/**
 * Notification handler - decode and process notification data
 * 
 * @param {aobject} nobj - Notification object
 */
function axNotificationHandler(gwObj, nobj) {

    if (gwObj.connectedDeviceList.hasOwnProperty(nobj.node)) {//check if the device is in the connected list 
        gwObj.connectedDeviceList[nobj.node].notificationHandler(gwObj, nobj);// call a notification handler that is associated with the device
    }
};



/* Process Notify: set on/off */
//var processNotify = function (robj) {
async function axIndicationHandler(gwObj, robj) {
    var dobj, handle, notifications, v, value;


    notifications = robj['notifications'];
    if (!notifications || notifications.length < 1)
        return;
    //printLine('(Indication Report) ' + JSON.stringify(robj, null, 0));

    for (var ii = 0; ii < notifications.length; ii++) {
        dobj = notifications[ii];
        //handle = dobj['handle'];
        var value = dobj['value'];
        did = robj.node;
        var ts = myUtils.convertUnixTimeToDateTime(dobj.tss + 1e-6 * dobj.tsus);  //add seconds and microseconds
        if (value.slice(-2) != '00') {
            axPutIndicationData(gwObj, did, value)
        }
        else {
            var pv = axGetIndicationData(gwObj, did);
            if (pv) {
                axFlushIndicationData(gwObj, did);
                value = pv + value;
            }

            var prstr = bgIsHexStringPrintable(value, true);
            var cardTypeExt = bgGetCardTypeExt(prstr)
            try {
                let battState = await gwObj.gapiAsync.read({ did: did, ch: '001a' });//Enable RFID scanner mode
                gwObj.connectedDeviceList[did].batt = GenericBatteryLevelSensor(battState.value).battery;
            }
            catch (err) {
                console.log('read batt err:[' + did + ']' + JSON.stringify(err, Object.getOwnPropertyNames(err)));
            }
            //console.log(gwObj.connectedDeviceList[did].name + '[' + myUtils.addrDisplaySwapEndianness(did) + '][' + ts + '][Batt=' + gwObj.connectedDeviceList[did].batt.padStart(2, "0") + '%][' + cardTypeExt.ct + '][' + JSON.stringify(cardTypeExt.payload, null, 0)+']');
            console.log(gwObj.connectedDeviceList[did].name + '[' + myUtils.addrDisplaySwapEndianness(did) + '][' + ts + '][Batt=' + gwObj.connectedDeviceList[did].batt + '%][' + cardTypeExt.ct + '][' + JSON.stringify(cardTypeExt.payload, null, 0) + ']');

        }
    }
};


function axPutIndicationData(gwObj, did, data) {
    if (gwObj.IndicationData[did]) {
        gwObj.IndicationData[did] = gwObj.IndicationData[did] + data;
    }
    else {
        gwObj.IndicationData[did] = data;
    }
}

function axGetIndicationData(gwObj, did) {
    if (gwObj.IndicationData[did]) {
        return gwObj.IndicationData[did];
    }
}


function axFlushIndicationData(gwObj, did) {
    if (gwObj.IndicationData[did]) {
        gwObj.IndicationData[did] = [];
    }
}


/* If hex-ASCII string, return ASCII string
 * hex-ASCII: each ASCII char is represented by 2 printable hex values
 * e.g. 'S' (0x53) represented by '5' and '3'
 */
bgIsHexStringPrintable = function (str, terminateOnNull) {
    var c, hi, ii, lo, ostr = '';

    if (typeof str != "string" || (str.length & 1))
        return '';

    for (ii = 0; ii < str.length; ii += 2) {
        /* Done if allowing null to terminate string (before end of string) */
        if (terminateOnNull) {
            if (str[ii] == '0' && str[ii + 1] == '0')
                break;
        }

        /* Done if end of string is null */
        if (ii == str.length - 2 && str[ii] == '0' && str[ii + 1] == '0')
            continue;

        hi = bgAsciiCharToNibble(str[ii]);
        lo = bgAsciiCharToNibble(str[ii + 1]);
        c = (hi << 4) | lo;
        if (c < 0x20 || c > 0x7f)
            return '';

        ostr += String.fromCharCode(c);
    }
    return ostr;
};

bgAsciiCharToNibble = function (c) {
    c = c.charCodeAt(0);
    if (c >= 0x30 && c <= 0x39)
        return c - 0x30;
    else if (c >= 0x41 && c <= 0x46)
        return c - 0x41 + 10;
    else if (c >= 0x61 && c <= 0x66)
        return c - 0x61 + 10;
    return 0;
};

/* Convert String to Uint8Array, padding with 0x00 if needed */
bgStringToUint8ArrayPadded = function (string, len) {
    var alen, array, i, slen;

    slen = string.length;
    alen = (slen < len) ? len : slen;

    array = new Uint8Array(alen);
    for (i = 0; i < slen; i++) {
        array[i] = string.charCodeAt(i);
    }

    for (i = slen; i < alen; i++)
        array[i] = 0;

    return array;
};

bgIsHexStringTerminated = function (str) {
    var ii;

    for (ii = 0; ii < str.length; ii += 2) {
        if (str[ii] === '0' && str[ii + 1] === '0')
            return true;
    }
    return false;
};



bgGetCardTypeExt = function (data) {
    var cardsType = [];
    cardsType[0x01] = "ISO 14443 type A (at least level 3)";
    cardsType[0x02] = "ISO 14443 type B (at least level 3)";
    cardsType[0x03] = "Felica";
    cardsType[0x04] = "ISO 15693";
    cardsType[0x08] = "NXP ICODE1";
    cardsType[0x10] = "Inside Secure PicoTag (including HID iClass)";
    cardsType[0x11] = "Innovision Topaz/Jewel";
    cardsType[0x18] = "Thinfilm NFC Barcode";
    cardsType[0x20] = "ST MicroElectronics SR family";
    cardsType[0x40] = "ASK CTS256B or CTS512B";
    cardsType[0x4F] = "NFC Forum";
    cardsType[0x80] = "Innovatron Radio Protocol (deprecated Calypso card)";
    cardsType['ht'] = "NFC Forum(2)";

    var cardType = parseInt(data[0] + data[1], 16);
    if (cardType in cardsType) {
        return { ct: cardsType[cardType], payload: data.substring(2) };
    }
    if (data.slice(0, 2) == 'ht') {
        return { ct: cardsType[0x4F], payload: data };
    }
    return { ct: "unknown(" + data.slice(0, 2) + ")", payload: data.substring(2) };
};
/**
 * Call this function to gracefully shutdown all connections
 * 
 * @param {number} retryCount - Number of retry attempts 
 * @param {string} prnStr - String to print before exit  
 */
async function axShutdown(retryCount, prnStr) {
    console.log(prnStr);
    exitFlag = true;
    for (let i = 0; i < gwArray.length; i++) {
        await axShutdownGW(gwArray[i], retryCount, prnStr)
    }
    if (gapiMain.isLogin) {
        await gapiMain.logout({});//logout
    }
    if (dataFileHandle)
        dataFileHandle.end();//close data file
    process.exit()
};

/**
 * Call this function to gracefully shutdown all connections
 *
 * @param {object} gwObj - Gateway object
 * @param {number} retryCount - Number of retry attempts 
 * @param {string} prnStr - String to print before exit  
 */
async function axShutdownGW(gwObj, retryCount, prnStr) {
    console.log('[' + gwObj.gwid + ']' + prnStr);
    if (gwObj.gapiAsync.isOpen) {//stop scanning
        if (gwObj.gapiAsync.isGWlive) {//only if gw is alive
            try {
                let ret = await gwObj.gapiAsync.list({ 'active': userConfig.scanParameters.active, 'period': 0 });//stop scan
                let cdev = await gwObj.gapiAsync.show({});
                if (cdev.nodes.length > 0) {
                    await gwObj.gapiAsync.disconnect({ did: '*' });
                }
            } catch (err) {
                console.log('Error' + JSON.stringify(err, Object.getOwnPropertyNames(err)));
                if (retryCount > 0)
                    setTimeout(async () => { await axShutdownGW(gwObj, retryCount--, retryCount + ' Shutdown...') }, 100);
            }
        }
        await gwObj.gapiAsync.close({});
    }
};

/**
 * Function to add gateway ID to adv data
 *
 * @param {object} gwObj - Gateway object
 * @param {Object[]} advItem - advArray - Array of advertsisement objects from report callback
 * @returns {Object} advObj - advArray - Array of advertsisement objects
 */
function axAddGWIDInfo(gwObj, advArray) {
    var advObj = [];
    var item;
    for (var i = 0; i < advArray.length; i++) {
        item = advArray[i];
        item.gw = gwObj.gwid;// add gwid info
        advObj.push(item);
    }
    return advObj;
}


/**
 * Function to extract advertisement data
 * 
 * @param {Object} advItem - Single advertisement object
 * @returns {Object} advObj - Single parsed advertisement data object
 */
function axAdvExtractData(advItem) {
    //console.log('Raw Scan ' + JSON.stringify(advItem));
    advObj = {
        gw: advItem.gw,// add gwid info
        ts: myUtils.convertUnixTimeToDateTime(advItem.tss + 1e-6 * advItem.tsus),    //Time stamp
        //did: myUtils.addrDisplaySwapEndianness(advItem.did),      //BLE address
        did: advItem.did,                                   //BLE address - only raw address can be used by API
        dt: advItem.dtype,                                  // Adress type
        ev: advItem.ev,                                     //adv packet type
        rssi: advItem.rssi,                                 //adv packet RSSI in dBm
        Nadv: advItem.adv.length,                            //payload length of adv packet
        Nrsp: advItem.rsp.length,                            //payload length of rsp packet
        name: axParseAdvGetName(advItem.adv, advItem.rsp),  //BLE device name
        //adv1: advItem.adv,       //payload of adv packet
        //rsp1: advItem.rsp,       //payload of rsp packet
        adv: {},       //payload of adv packet
        rsp: {},       //payload of rsp packet
    };

    for (let i = 0; i < advItem.adv.length; i++) {
		if(typeof advItem.adv[i].t === "undefined"){
		}
		else {
			if (advObj.adv[advItem.adv[i].t])
				advObj.adv[advItem.adv[i].t].push(advItem.adv[i].v)
			else
				advObj.adv[advItem.adv[i].t] = [advItem.adv[i].v]
		}
    }
    if (advItem.rsp) {
        for (let i = 0; i < advItem.rsp.length; i++) {
			if(typeof advItem.rsp[i].t === "undefined"){
			}
			else {
				if (advObj.adv[advItem.rsp[i].t])
					advObj.rsp[advItem.rsp[i].t].push(advItem.rsp[i].v)
				else
					advObj.rsp[advItem.rsp[i].t] = [advItem.rsp[i].v]
			}
        }
    }
    return advObj;
}

/**
 * Format adv packets to print to screen using console.log
 * 
 * @param {Object{}} advList - List of advertsisement objects from report callback
 */
function axPrintAdvListScreen(advList) {
    for (var key in advList) {
        console.log(JSON.stringify(advList[key], null, 0));
    }
}

/**
 * Format adv packets to print to screen using console.log
 * 
 * @param {Object []} advArray - Array of advertsisement objects from report callback
 */
function axPrintAdvArrayScreen(advArray) {
    for (var i = 0; i < advArray.length; i++) {
        console.log(JSON.stringify(advArray[i], null, 0));
    }
}

/**
 * Function to match all devices(dummy)
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchAll(advItem) {
    return (true);
}


/**
 * Function to match TI sensorTag, see http://processors.wiki.ti.com/index.php/CC2650_SensorTag_User%27s_Guide
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchSensorTag(advItem) {
    return (advItem.name == "CC2650 SensorTag");
}

/**
 * Function to match D600 using the service ID
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchD600(advItem) {
    if (advItem.adv[6] && (advItem.adv[6] == "f03c155f53d7b1acef4ef696b701b56c"))
        return true;
    else
        return false;
}

/**
 * Function to match Sensirion SHT31 EVM
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchSensirionSHT31(advItem) {
    return (advItem.name == "Smart Humigadget");
}

/**
 * Function to extract advertisement data from EM beacon
 * 
 * @param {Object []} advItem - Array of advertisement object
 * @returns {Object []} advObj - Array of parsed advertisement data object of EMbeacon type
 */
function axMatchEMTag(advArray) {
    var advDidArray = [];
    var devEM = {}
    var name;
    for (var i = 0; i < advArray.length; i++) {
        name = axParseAdvGetName(advArray[i].adv, advArray[i].rsp);

        if ((name != null) && (name.slice(0, 8) == "EMBeacon")) {//Match for device name
            for (var j = 0; j < advArray[i].adv.length; j++) {
                if (advArray[i].adv[j].t == 255) {
                    devEM.name = name;
                    devEM.did = advArray[i].did;
                    devEM.dt = advArray[i].dtype;
                    devEM.rssi = advArray[i].rssi;
                    devEM.ts = myUtils.convertUnixTimeToDateTime(advArray[i].tss + 1e-6 * advArray[i].tsus);
                    devEM.manufacturerID = swapEndianness(advArray[i].adv[j].v.slice(0, 4));


                    devEM.sensorData = parseInt('0x' + advArray[i].adv[j].v.slice(4, 8));

                    var buffer1 = new Buffer(advArray[i].adv[j].v.slice(8, 12), 'hex');
                    devEM.modelNumber = buffer1.toString('utf8');

                    var battVoltageI = parseInt('0x' + advArray[i].adv[j].v.slice(12, 13));
                    var battVoltageD = parseInt('0x' + advArray[i].adv[j].v.slice(13, 14));

                    devEM.battVoltage = battVoltageI + 0.1 * battVoltageD;

                    devEM.packetCount = parseInt('0x' + advArray[i].adv[j].v.slice(14, 22));
                    devEM.swEvent = parseInt('0x' + advArray[i].adv[j].v.slice(22, 26));

                }
            }
            advDidArray.push(devEM)
        }
    }
    return advDidArray;
}

/**
 * Generic battery service data
 * Extract battery level data from hexstring.
 * 
 * @param {string} str - hexstring pressure data
 * 
 * @returns {object} - temperature and pressure
 */
function GenericBatteryLevelSensor(str) {
    const buf = Buffer.from(str, 'hex');
    const B = buf.readUInt8(0);//Battery level from 0 to 100
    return { 'battery': B };
}

/**
 * Get device name from advertisement packet
 * 
 * @param {Object} adv - Advertisement payload
 * @param {Object} rsp - Scan response payload
 * @returns {string} - Name of the device or null if not present
 */
function axParseAdvGetName(adv, rsp) {
    var didName = '';
    for (var i = 0; i < adv.length; i++) {
        if ((adv[i].t == 8) || (adv[i].t == 9)) {
            didName = adv[i].v;
            return didName;
        }
    }
    for (var i = 0; i < rsp.length; i++) {
        if ((rsp[i].t == 8) || (rsp[i].t == 9)) {
            didName = rsp[i].v;
            return didName;
        }
    }
    return didName;
}

/**
 * Add ADV data to gloabl list
 * 
 * @param {Object[]} advArray - Array of advertsisement objects from report callback
 */
function axUpdateAdvNodeList(targetAdvList, advArray) {
    for (var i = 0; i < advArray.length; i++) {
        targetAdvList[advArray[i].did] = advArray[i];
    }
}

/**
 * Format adv packets to print to file using fs
 *
 * @param {string | null} fileHandle - filehandle
 * @param {Object[]} advArray - Array of advertsisement objects from report callback
 * @param {boolean} writeHeaderFlag - write csv file header if true
 * @returns {boolean} flag set to false to prevent header write on next call
 */
function axPrintNotificationDataToFile(fileHandle, writeHeaderFlag, ts, did, hdl, subID, data) {
    var str = "";
    if (fileHandle) {
        if (writeHeaderFlag) {
            str = "ts,did,hdl,data\n";
            fileHandle.write(str);//write CSV header one time
        }
        str = `${ts},${did},${parseInt(hdl, 16)},${subID},${data}\n`;
        fileHandle.write(str);//write CSV header one time
        return false;//Use this value to update writeHeaderFlag in calling function
    }
}

/**
 * Utility to wait until the callback return true
 * 
 * @param {number} intervalInMilliseconds -  Polling interval to run the callback cb
 * @param {number} timeoutInMilliseconds - Timeout in milliseconds
 * @param {function} cb - Callback function - waits in the loop until cb retunr true.
 * @returns {promise} returns a promise
 */
function axCheckTaskCompletion(intervalInMilliseconds, timeoutInMilliseconds, cb) {
    let self = this;
    return new Promise((resolve, reject) => {
        self.intervalListener = setInterval(function () {
            if (cb()) {
                clearInterval(self.intervalListener);
                clearTimeout(self.timeoutVar);
                resolve();
            }
        }, intervalInMilliseconds);
        self.timeoutVar = setTimeout(function () {
            clearInterval(self.intervalListener);
            reject({ "result": 408, "error": 'Timeout after ' + timeoutInMilliseconds + ' ms' });

        }, timeoutInMilliseconds);
    });
}