# homebridge-philips-saphi-tv
Homebridge module for Philips TV (with JointSpace enabled) with Power on/off

# Description

This plugin is a fork of TheAbstractDev/homebridge-philips-saphi-tv (https://github.com/TheAbstractDev/homebridge-philips-saphi-tv).

It has been modified to work on a 55OLED754/12 TV (2020 model with SaphiTV OS - not Android TV) and may not work on other ones. Code may need ajustement for Ambilight to work on other models


# Configuration
 
Example accessory config (needs to be added to the homebridge config.json):
To be able to power on the TV when the TV is in standby mode, you will need the wol_url parameters with the mac address of your TV
Added test option for WakeOnWLAN:

 ```
"accessories": [
    {
        "accessory": "PhilipsSaphirTV",
        "name": "TV",
        "ip_address": "10.0.1.23",
        "poll_status_interval": "60",
        "model_year" : "2020",
        "model_name": "75PUS7805/12",
        "model_serial_no": "123-456-ABC",
        "wol_url": "wol://18:8e:d5:a2:8c:66"
    }
]
 ```

