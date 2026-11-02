# Tapo Doorbell Press

Adds local doorbell press detection to your existing Tapo D235 camera in Scrypted. Use it with Scrypted's HomeKit plugin to receive doorbell notifications in Apple Home.

The extension uses the address already saved in your camera's ONVIF settings. No Tapo cloud connection or additional camera address is needed.

## Requirements

- A Tapo D235 already added to Scrypted through the ONVIF plugin.
- A network connection that allows the doorbell's local notifications to reach Scrypted (see troubleshooting below).
- Scrypted's HomeKit plugin, if you want notifications in Apple Home.

Doorbell detection may vary with camera firmware.

## Setup

1. Install **Tapo Doorbell Press** in Scrypted.
2. Open your Tapo camera under **Devices**.
3. Under **Extensions**, enable **Tapo Doorbell Press**.
4. In the camera's **Tapo Doorbell Press** settings, select **Test Doorbell Press** or press the physical doorbell to confirm detection works.

This extension works with your existing camera; there is no separate button device to add.

## HomeKit

For doorbell notifications in Apple Home, the camera must be configured as a doorbell:

1. In the camera's ONVIF settings, open **Advanced**, enable **Onvif Doorbell**, and save.
2. Enable the **HomeKit** extension on the camera (if it is not already enabled).
3. If the camera was already added to Apple Home, reload the HomeKit plugin. You may need to remove and pair the accessory again for Apple Home to recognise it as a doorbell.

## Troubleshooting

**The test works, but pressing the doorbell does nothing**

The doorbell sends doorbell press notifications to the LAN on UDP port **20005**. Scrypted must be able to receive these broadcasts. Keep the doorbell and Scrypted on the same network where possible; broadcasts usually do not cross VLANs, even with firewall rules allowing the port.

**The camera address has changed**

Update the address in the camera's ONVIF settings. This extension picks up changes automatically. If detection still fails, check the camera's console for address or connection errors.
