import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type Env } from '../runtime/build-info.js';
import { settingDefaults, type SettingValue } from './context.js';

type Setting = NonNullable<ExtensionPackage['agentage']['settings']>[string];

const fits = (setting: Setting, value: unknown): value is SettingValue => {
  if (setting.type === 'integer' ? !Number.isInteger(value) : typeof value !== setting.type)
    return false;
  return !setting.enum || setting.enum.includes(String(value));
};

const parseObject = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AGENTAGE_SETTINGS is not a JSON object');
  }
  return value as Record<string, unknown>;
};

// The host's values (AGENTAGE_SETTINGS, JSON) over the defaults; a wrong type stops the start.
export const settingsFromEnv = (pkg: ExtensionPackage, env: Env, log: Log) => {
  const declared = pkg.agentage.settings ?? {};
  const given = env['AGENTAGE_SETTINGS'] ? parseObject(env['AGENTAGE_SETTINGS']) : {};
  const values = settingDefaults(pkg);
  for (const [key, value] of Object.entries(given)) {
    const setting = declared[key];
    if (!setting) log.warn('setting not declared in the manifest, ignored', { setting: key });
    else if (fits(setting, value)) values[key] = value;
    else throw new Error(`setting ${key}: ${JSON.stringify(value)} does not fit its declaration`);
  }
  return values;
};
