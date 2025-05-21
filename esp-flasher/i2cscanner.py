from machine import I2C, Pin
import time

# Initialize I2C on default pins for ESP32 / ESP8266:
# Adjust sda= and scl= pins if needed for your board
i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)

def scan_i2c():
    print("\nSoldered I2C Scanner!")
    while True:
        print("Scanning...")
        devices = i2c.scan()
        if devices:
            for device in devices:
                print("I2C device found at address 0x{:02X}!".format(device))
        else:
            print("No I2C devices found")
        print("done\n")
        time.sleep(5)

if __name__ == "__main__":
    scan_i2c()
