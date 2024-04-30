function parseDotKeys(...keys: string[]): string[] {
  const result : string[] = [];
  for (const key of keys) {
    if (key.includes('.')) {
      result.push(...key.split('.'));
    } else {
      result.push(key);
    }
  }
  return result;
}

function buildDotKeys(obj: any) {
  const result: string[] = [];
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      for (const subkey of buildDotKeys(obj[key])) {
        result.push(`${key}.${subkey}`);
      }
    } else {
      result.push(key);
    }
  }
  return result;
}

export class ConfigMap {
  public obj: any = {};
  public static readonly configNames: string[] = [
    'asciiArt',
    'formatting',
    'logging',
    'snippets',
    'completion',
    'hover',
    'rename',
    'definition',
    'references',
    'diagnostics',
    'signatureHelp',
    'codeAction',
    'index',
  ];

  consructor() {}

  setValueFromKeys(value: any, ...keys: string[]): void {
    const fixedKeys = parseDotKeys(...keys);
    // console.log(fixedKeys.length, keys.length, keys, fixedKeys, value)
    fixedKeys.reduce((acc, key, index) => {
      if (index === fixedKeys.length - 1) {
        acc[key] = value;
      } else {
        acc[key] = acc[key] || {};
      }
      return acc[key];
    }, this.obj);
  }

  setKV(key: string, value: any): void {
    this.setValueFromKeys(value, key);
  }

  toggleFeature(feature: string, value: boolean = true): void {
    this.setValueFromKeys({ enabled: value }, feature);
  }

  getToplevelKeys(): string[] {
    return Array.from(Object.keys(this.obj));
  }

  log(): void {
    console.log('-'.repeat(80));
    console.log('ConfigMap');
    console.log(JSON.stringify(this.obj, null, 2));
  }

  setup(enable: boolean = true) {
    for (const option of ConfigMap.configNames) {
      this.toggleFeature(option, enable);
    }
    return this;
  }

  getValue(...keys: string[]): any {
    const fixedKeys = parseDotKeys(...keys);
    return fixedKeys.reduce((acc, key) => {
      return acc[key];
    }, this.obj);
  }

  getKeysStrs(): string[] {
    return buildDotKeys(this.obj);
  }
}

export function bareStartupManger() {
  const map = new ConfigMap();

  return map.setup(false);
}

export function mainStartupManager() {
  const map = new ConfigMap();
  return map.setup(true);
}