var Service;
var Characteristic;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var wol = require('wake_on_lan');

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-saphir-tv", "PhilipsSaphirTV", HttpStatusAccessory);
}

function HttpStatusAccessory(log, config) {
    this.log = log;
    var that = this;

    // CONFIG
    this.ip_address = config["ip_address"];
    this.name = config["name"];
    this.poll_status_interval = config["poll_status_interval"] || "0";
    this.model_year = config["model_year"];
    this.wol_url = config["wol_url"] || "";
    this.model_year_nr = parseInt(this.model_year);
    this.set_attempt = 0;
	this.model_name = config["model_name"];
	this.model_version = config["model_version"];
    this.model_serial_no = config["model_serial_no"];
    this.activeServices = [];

    // CREDENTIALS FOR API
    this.username = config["username"] || "";
    this.password = config["password"] || "";

    // CHOOSING API VERSION BY MODEL/YEAR
    switch (this.model_year_nr) {
	case 2020:
	    this.api_version = 6;
	    break;
        case 2019:
            this.api_version = 6;
            break;
        case 2018:
            this.api_version = 6;
            break;
        case 2017:
            this.api_version = 6;
            break;
        case 2016:
            this.api_version = 6;
            break;
        case 2015:
            this.api_version = 5;
            break;
        case 2014:
            this.api_version = 5;
            break;
        default:
            this.api_version = 1;
    }

    // CONNECTION SETTINGS
    this.protocol = "http"
    this.portno = "1925"
    this.need_authentication = this.username != '' ? 1 : 0;

    this.log("Model year: " + this.model_year_nr);
    this.log("API version: " + this.api_version);

    this.state_power = true;

    // Define URL & JSON Payload for Actions

    // POWER
    this.power_url = this.protocol + "://" + this.ip_address + ":" + this.portno + "/" + this.api_version + "/powerstate";
    this.power_on_body = JSON.stringify({
        "powerstate": "On"
    });
    this.power_off_body = JSON.stringify({
        "powerstate": "Standby"
    });
    
    // POLLING ENABLED?
    this.interval = parseInt(this.poll_status_interval);
    this.switchHandling = "check";
    if (this.interval > 10 && this.interval < 100000) {
        this.switchHandling = "poll";
    }

    // STATUS POLLING
    if (this.switchHandling == "poll") {
        var statusemitter = pollingtoevent(function(done) {
            that.getPowerState(function(error, response) {
                done(error, response, that.set_attempt);
            }, "statuspoll");
        }, {
            longpolling: true,
            interval: that.interval * 1000,
            longpollEventName: "statuspoll_power"
        });

        statusemitter.on("statuspoll_power", function(data) {
            that.state_power = data;
            if (that.switchService) {
                that.switchService.getCharacteristic(Characteristic.On).setValue(that.state_power, null, "statuspoll");
            }
        });
    }
}

/////////////////////////////

HttpStatusAccessory.prototype = {

	// Sometime the API fail, all calls should use a retry method, not used yet but goal is to replace all the XLoop function by this generic one
    httpRequest_with_retry: function(url, body, method, need_authentication, retry_count, callback) {
        this.httpRequest(url, body, method, need_authentication, function(error, response, responseBody) {
            if (error) {
                if (retry_count > 0) {
                    this.log('Got error, will retry: ', retry_count, ' time(s)');
                    this.httpRequest_with_retry(url, body, method, need_authentication, retry_count - 1, function(err) {
                        callback(err);
                    });
                } else {
                    this.log('Request failed: %s', error.message);
                    callback(new Error("Request attempt failed"));
                }
            } else {
                this.log('succeeded - answer: %s', responseBody);
                callback(null, response, responseBody);
            }
        }.bind(this));
    },

    httpRequest: function(url, body, method, need_authentication, callback) {
        var options = {
            url: url,
            body: body,
            method: method,
            rejectUnauthorized: false,
            timeout: 1000
        };

        // EXTRA CONNECTION SETTINGS FOR API V6 (HTTP DIGEST)
        if (need_authentication) {
            options.followAllRedirects = true;
            options.forever = true;
            options.auth = {
                user: this.username,
                pass: this.password,
                sendImmediately: false
            }
        }

        req = request(options,
            function(error, response, body) {
                callback(error, response, body)
        	}
        );
    },

    wolRequest: function(url, callback) {
        this.log('calling WOL with URL %s', url);
        if (!url) {
            callback(null, "EMPTY");
            return;
        }
        if (url.substring(0, 3).toUpperCase() == "WOL") {
            //Wake on lan request
            var macAddress = url.replace(/^WOL[:]?[\/]?[\/]?/ig, "");
            this.log("Excuting WakeOnLan request to " + macAddress);
            wol.wake(macAddress, function(error) {
                if (error) {
                    callback(error);
                } else {
                    callback(null, "OK");
                }
            });
        } else {
            if (url.length > 3) {
                callback(new Error("Unsupported protocol: ", "ERROR"));
            } else {
                callback(null, "EMPTY");
            }
        }
    },

    // POWER FUNCTIONS -----------------------------------------------------------------------------------------------------------
    setPowerStateLoop: function(nCount, url, body, powerState, callback) {
        var that = this;

        that.httpRequest(url, body, "POST", this.need_authentication, function(error, response, responseBody) {
            if (error) {
                if (nCount > 0) {
                    that.log('setPowerStateLoop - powerstate attempt, attempt id: ', nCount - 1);
                    that.setPowerStateLoop(nCount - 1, url, body, powerState, function(err, state_power) {
                        callback(err, state_power);
                    });
                } else {
                    that.log('setPowerStateLoop - failed: %s', error.message);
                    powerState = false;
                    callback(new Error("HTTP attempt failed"), powerState);
                }
            } else {
                that.log('setPowerStateLoop - Succeeded - current state: %s', powerState);
                callback(null, powerState);
            }
        });
    },

    setPowerState: function(powerState, callback, context) {
        var url = this.power_url;
        var body;
        var that = this;

		this.log.debug("Entering %s with context: %s and target value: %s", arguments.callee.name, context, powerState);

        if (context && context == "statuspoll") {
				callback(null, powerState);
				return;
        }

        this.set_attempt = this.set_attempt + 1;

        if (powerState) {
            if (this.model_year_nr <= 2013) {
                this.log("Power On is not possible for model_year before 2014.");
                callback(new Error("Power On is not possible for model_year before 2014."));
            }
            body = this.power_on_body;
            this.log("setPowerState - Will power on");
			// If Mac Addr for WOL is set
			if (this.wol_url) {
				that.log('setPowerState - Sending WOL');
				this.wolRequest(this.wol_url, function(error, response) {
					that.log('setPowerState - WOL callback response: %s', response);
					that.log('setPowerState - powerstate attempt, attempt id: ', 8);
					//execute the callback immediately, to give control back to homekit
					callback(error, that.state_power);
					that.setPowerStateLoop(8, url, body, powerState, function(error, state_power) {
						that.state_power = state_power;
						if (error) {
							that.state_power = false;
							that.log("setPowerStateLoop - ERROR: %s", error);
							if (that.switchService) {
								that.switchService.getCharacteristic(Characteristic.On).setValue(that.state_power, null, "statuspoll");
							}
						}
					});
				}.bind(this));
			}
        } else {
            body = this.power_off_body;
            this.log("setPowerState - Will power off");
            that.setPowerStateLoop(0, url, body, powerState, function(error, state_power) {
                that.state_power = state_power;
                if (error) {
                    that.state_power = false;
                    that.log("setPowerStateLoop - ERROR: %s", error);
                }
                if (that.switchService) {
                    that.switchService.getCharacteristic(Characteristic.On).setValue(that.state_power, null, "statuspoll");
                }
                if (that.ambilightService) {
                    that.state_ambilight = false;
                    that.ambilightService.getCharacteristic(Characteristic.On).setValue(that.state_ambilight, null, "statuspoll");
                }
                 if (that.volumeService) {
                    that.state_volume = false;
                    that.volumeService.getCharacteristic(Characteristic.On).setValue(that.state_volume, null, "statuspoll");
                }
                callback(error, that.state_power);
            }.bind(this));
        }
    },

    getPowerState: function(callback, context) {
        var that = this;
        var url = this.power_url;

        that.log("getPowerState with : %s", url);
   		this.log.debug("Entering %s with context: %s and current value: %s", arguments.callee.name, context, this.state_power);
        //if context is statuspoll, then we need to request the actual value else we return the cached value
		if ((!context || context != "statuspoll") && this.switchHandling == "poll") {
            callback(null, this.state_power);
            return;
        }

        this.httpRequest(url, "", "GET", this.need_authentication, function(error, response, responseBody) {
            var tResp = that.state_power;
            var fctname = "getPowerState";
            if (error) {
				that.log("getPowerState with : %s", url);
                that.log('%s - ERROR: %s', fctname, error.message);
                that.state_power = false;
            } else {
                if (responseBody) {
                    var responseBodyParsed;
                    try {
                        responseBodyParsed = JSON.parse(responseBody);
                        if (responseBodyParsed && responseBodyParsed.powerstate) {
                        	tResp = (responseBodyParsed.powerstate == "On") ? 1 : 0;
						} else {
		                    that.log("%s - Could not parse message: '%s', not updating state", fctname, responseBody);
						}
                    } catch (e) {
						that.log("getPowerState with : %s", url);
                        that.log("%s - Got non JSON answer - not updating state: '%s'", fctname, responseBody);
			responseBodyParsed = false;
                    }
                }
                if (that.state_power != tResp) {
                    that.log('%s - Level changed to: %s', fctname, tResp);
	                that.state_power = tResp;
                }
            }
            callback(null, that.state_power);
        }.bind(this));
    },

    identify: function(callback) {
        this.log("Identify requested!");
        callback(); // success
    },

    configureInformationService: function() {
        var informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.Manufacturer, 'Philips')
            .setCharacteristic(Characteristic.Model, this.model_name)
			.setCharacteristic(Characteristic.FirmwareRevision, this.model_version)
            .setCharacteristic(Characteristic.SerialNumber, this.model_serial_no);

        this.activeServices.push(informationService)
    },

    configureTelevisionService: function() {
        this.televisionService = new Service.Television();
	    this.televisionService
            .setCharacteristic(Characteristic.ConfiguredName, "TV");

        // POWER
        this.televisionService
            .getCharacteristic(Characteristic.Active)
            .on('get', this.getPowerState.bind(this))
            .on('set', this.setPowerState.bind(this));

        this.televisionService
            .setCharacteristic(
                 Characteristic.SleepDiscoveryMode,
                 Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
            );

        this.televisionService
            .getCharacteristic(Characteristic.RemoteKey)
            .on('set', this.sendKey.bind(this));


        this.activeServices.push(this.televisionService);
    },

    getServices: function() {
        var that = this;
        this.configureTelevisionService()
        
        return this.activeServices;
    }
};
