/**
 * Tapo Doorbell Press – Scrypted camera mixin.
 *
 * Adds BinarySensor to an existing ONVIF camera/doorbell. No child device,
 * manual IP entry, audio implementation, or HomeKit code is required.
 *
 * Listens for local UDP/20005 notifications from Tapo doorbells. The actual
 * packet contents are proprietary; only use on a trusted LAN and verify
 * UDP/20005 corresponds to physical presses on your firmware.
 */
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import sdk, {
  type BinarySensor,
  type EventListenerRegister,
  type MixinProvider,
  type ScryptedDevice,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  type Setting,
  type Settings,
  type SettingValue,
  type WritableDeviceState,
} from '@scrypted/sdk';
import { SettingsMixinDeviceBase, type SettingsMixinDeviceOptions } from '@scrypted/sdk/settings-mixin';

const UDP_PORT = 20005;
const PULSE_MS = 1000;
const DEBOUNCE_MS = 1800;
const OLD_BUTTON_ID = 'tapo-doorbell-button';

function hostFromOnvifSetting(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (isIP(raw) === 4) return raw;
  // Normally Scrypted ONVIF's `ip` is an IPv4 address. Handle an optional
  // host:port or URL without requiring an additional setting.
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return url.hostname || undefined;
  } catch {
    return undefined;
  }
}

class TapoDoorbellPressMixin extends SettingsMixinDeviceBase<ScryptedDevice> implements BinarySensor {
  private ip?: string;
  private listeningToSettings?: EventListenerRegister;
  private resetTimer?: ReturnType<typeof setTimeout>;
  private lastPressAt = 0;
  private stopped = false;

  constructor(options: SettingsMixinDeviceOptions<ScryptedDevice>) {
    super(options);
    this.binaryState = false;

    // ONVIF already owns the address. Read its Settings and refresh when they change.
    this.listeningToSettings = this.mixinDevice.listen(ScryptedInterface.Settings, () => {
      void this.refreshAddress();
    });
    void this.refreshAddress();
  }

  get sourceAddress(): string | undefined {
    return this.ip;
  }

  private async refreshAddress(): Promise<void> {
    try {
      const settings = await this.mixinDevice.getSettings();
      const raw = settings.find(s => s.key === 'ip')?.value;
      const host = hostFromOnvifSetting(raw);
      if (!host) {
        this.ip = undefined;
        this.console.warn('No ONVIF IP setting found; no doorbell packets will be accepted.');
        return;
      }
      const resolvedIp = isIP(host) === 4 ? host : (await lookup(host, { family: 4 })).address;
      if (this.stopped) return;
      if (this.ip !== resolvedIp) {
        this.ip = resolvedIp;
        this.console.log(`Tracking Tapo doorbell presses from ${this.ip} (ONVIF IP).`);
      }
    } catch (error) {
      this.ip = undefined;
      this.console.error('Could not read/resolve the ONVIF camera IP:', error);
    }
  }

  handlePacket(remote: RemoteInfo): void {
    if (this.stopped || !this.ip || remote.address !== this.ip) return;
    const now = Date.now();
    if (now - this.lastPressAt < DEBOUNCE_MS) return;
    this.lastPressAt = now;
    this.console.log(`Tapo button press: ${remote.address}:${remote.port} -> ${this.name}`);
    this.press();
  }

  private press(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    // Scrypted's HomeKit plugin listens for BinarySensor rising edges.
    this.binaryState = false;
    this.binaryState = true;
    this.resetTimer = setTimeout(() => {
      if (!this.stopped) this.binaryState = false;
      this.resetTimer = undefined;
    }, PULSE_MS);
  }

  async getMixinSettings(): Promise<Setting[]> {
    return [
      {
        key: 'testPress',
        title: 'Test Doorbell Press',
        type: 'button',
        description: 'Simulate a doorbell press to test notifications.',
      },
    ];
  }

  async putMixinSetting(key: string, _value: SettingValue): Promise<void> {
    if (key === 'testPress') {
      this.console.log('Simulating a doorbell press on this camera.');
      this.press();
      return;
    }
    throw new Error(`Unknown or read-only setting: ${key}`);
  }

  override async release(): Promise<void> {
    this.stopped = true;
    this.listeningToSettings?.removeListener();
    this.listeningToSettings = undefined;
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.binaryState = false;
    await super.release();
  }
}

class TapoDoorbellPressPlugin extends ScryptedDeviceBase implements MixinProvider {
  private readonly activeMixins = new Map<string, TapoDoorbellPressMixin>();
  private socket?: Socket;

  constructor() {
    super();
    // One-time migration: remove the virtual sensor created by version 0.1.
    // This version supplies BinarySensor as a mixin, not an independent device.
    process.nextTick(() => {
      void sdk.deviceManager.onDeviceRemoved(OLD_BUTTON_ID).catch(() => {});
    });
  }

  async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[] | undefined> {
    if (type !== ScryptedDeviceType.Camera && type !== ScryptedDeviceType.Doorbell) return;
    if (!interfaces.includes(ScryptedInterface.VideoCamera) || !interfaces.includes(ScryptedInterface.Settings)) return;
    return [ScryptedInterface.BinarySensor, ScryptedInterface.Settings];
  }

  async getMixin(mixinDevice: ScryptedDevice & Settings, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
    const mixin = new TapoDoorbellPressMixin({
      mixinDevice,
      mixinDeviceInterfaces,
      mixinDeviceState,
      mixinProviderNativeId: this.nativeId,
      group: 'Tapo Doorbell Press',
      groupKey: 'tapoDoorbellPress',
    });

    const previous = this.activeMixins.get(mixin.id);
    if (previous) await previous.release();
    this.activeMixins.set(mixin.id, mixin);
    this.ensureListener();
    return mixin;
  }

  async releaseMixin(id: string, mixinDevice: TapoDoorbellPressMixin): Promise<void> {
    const current = this.activeMixins.get(id);
    if (current) this.activeMixins.delete(id);
    await (current ?? mixinDevice)?.release();
    if (this.activeMixins.size === 0) {
      this.socket?.close();
      this.socket = undefined;
    }
  }

  private ensureListener(): void {
    if (this.socket) return;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('message', (_payload: Buffer, remote: RemoteInfo) => {
      for (const mixin of this.activeMixins.values()) mixin.handlePacket(remote);
    });
    socket.on('error', (error) => {
      this.console.error(`UDP/${UDP_PORT} listener error:`, error);
      try { socket.close(); } catch { /* may already be closed */ }
      if (this.socket === socket) this.socket = undefined;
    });
    socket.bind(UDP_PORT, '0.0.0.0', () => {
      this.console.log(`Tapo Doorbell Press extension listening on UDP/${UDP_PORT}.`);
    });
  }
}

export default new TapoDoorbellPressPlugin();
