# D600-Async
Collect Scan Data from multiple [Socket Mobile D600](https://www.socketmobile.com/products/600-series/durascan/d600)  using [Axiomware's](http://www.axiomware.com) [netrunr-gapi-async](http://www.axiomware.com/apidocs/index.html) Javascript SDK

Program to execute following steps:
- Connect to Axiomware accountillustrate
- List all gateways associated with this account and use UI to select one or more of the gateways
- Connect to the selected gateway(s)
- Scan for advertisements and filter to show only Socket Mobile D600 devices
- Connect to one or more D600 devices
- If D600 has not been previously bonded to the gateway, it will create a create secure connection and bond
- If D600 has been bonded before, it will reuse the bond. If the bond is invalid, reset the D600 bond and restart the D600. Netrunr will automatically start a fresh pairing sequence.
- Configure the D600 into single scan or continuous scan mode
- Display scan results on screen
- Use CTRL-C to exit program

**This example uses promises and async/await functionality present in Nodejs version 8.+**.

## SDK, Documentation and examples
- [Netrunr B24C API Documentation](http://www.axiomware.com/apidocs/index.html)
- [Netrunr-gapi SDK](https://github.com/axiomware/netrunr-gapi-js)
  - [List of Netrunr-gapi examples](https://github.com/axiomware/list-of-examples-netrunr-gapi)
- [Netrunr-gapi-async SDK](https://github.com/axiomware/netrunr-gapi-async-js)
  - [List of Netrunr-gapi-async examples](https://github.com/axiomware/list-of-examples-netrunr-gapi-async)

## Requirements

- [Netrunr B24C](http://www.axiomware.com/netrunr-b24c-product.html) gateway
- Axiomware cloud account. See the Netrunr [quick start guide](http://www.axiomware.com/page-netrunr-b24c-qs-guide.html) on creating an account.
- Nodejs (see [https://nodejs.org/en/](https://nodejs.org/en/) for download and installation instructions)
  - Nodejs version 8.x.x is required due to the use of promises/async/await
- NPM (Node package manager - part of Nodejs)   
- Windows, MacOS or Linux computer with access to internet
- One of more Socket Mobile D600 NFC scanners.

## Installation

The following steps assume that you have successfully installed Node.js. Following steps will have to be executed in a terminal window or command shell.

Clone the repo

`git clone https://github.com/axiomware/d600-async.git`

or download as zip file to a local directory and unzip.

Install all module dependencies by running the following command inside the directory

  `npm install`


## Usage

Run the nodejs application:

    node appD600Async.js

To force exit, use:

    CTRL-C  

## Error conditions/Troubleshooting

- If the program is not able to login, check your credentials.
- If the gateway is not listed in your account, it may not have been successfully provisioned. See the Netrunr [quick start guide](http://www.axiomware.com/page-netrunr-b24c-qs-guide.html) for provisioning the gateway.
- Not able to get version information of the gateway. Check if gateway is powered ON and has access to internet. Also, check if firewall is blocking internet access.
- If you're not able to locate your device, check if your BLE device is advertising. The D600 will stop advertising after few minutes. Verify that the D600 is not connected to some other device. If the D600 is advertising, the blue LED will be blinking.

## Contributing

In lieu of a formal style guide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code.    
