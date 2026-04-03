/**
 * Data display UI component - shows live fitness data and FTMS output.
 *
 * Live Data fields are derived directly from device spec JSON files via DeviceSpecParser,
 * so adding a new device spec automatically gets proper display with no code changes here.
 *
 * The FIELD_DISPLAY_MAP is the only thing to update when a new type of field is invented.
 */

import { FitnessData, FtmsOutput, AppSettings } from '../../shared/types';
import { DeviceSpecParser } from '../services/device-spec-parser';

interface FieldConfig {
  id: string;
  label: string;
  unit: string;
  getValue: (data: FitnessData) => string;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Universal display config for every field name that can appear in FitnessData.
 * Update this when a new field type is added to the system, not when a new device is added.
 */
const FIELD_DISPLAY_MAP: Record<string, { label: string; unit: string; getValue: (data: FitnessData) => string }> = {
  power:      { label: 'Power',      unit: 'W',    getValue: (d) => d.power      !== undefined ? Math.round(d.power).toString()      : '--' },
  cadence:    { label: 'Cadence',    unit: 'RPM',  getValue: (d) => d.cadence    !== undefined ? Math.round(d.cadence).toString()    : '--' },
  heartRate:  { label: 'Heart Rate', unit: 'BPM',  getValue: (d) => d.heartRate  !== undefined ? Math.round(d.heartRate).toString()  : '--' },
  speed:      { label: 'Speed',      unit: 'km/h', getValue: (d) => d.speed      !== undefined ? d.speed.toFixed(1)                  : '--' },
  calories:   { label: 'Calories',   unit: 'kcal', getValue: (d) => d.calories   !== undefined ? Math.round(d.calories).toString()   : '--' },
  duration:   { label: 'Duration',   unit: '',     getValue: (d) => d.duration   !== undefined ? formatDuration(d.duration)          : '--' },
  distance:   { label: 'Distance',   unit: 'km',   getValue: (d) => d.distance   !== undefined ? d.distance.toFixed(2)               : '--' },
  gear:       { label: 'Gear',       unit: '',     getValue: (d) => d.gear       !== undefined ? Math.round(d.gear).toString()       : '--' },
  resistance: { label: 'Resistance', unit: '',     getValue: (d) => d.resistance !== undefined ? d.resistance.toString()             : '--' },
};

const FTMS_ONLY_FIELDS = ['power', 'cadence', 'heartRate'];

function buildFieldConfigs(fieldNames: string[]): FieldConfig[] {
  return fieldNames
    .map(name => {
      const display = FIELD_DISPLAY_MAP[name];
      if (!display) return null;
      return { id: name, ...display };
    })
    .filter((f): f is FieldConfig => f !== null);
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  liveDataMode: 'device',
  trustedDevices: [],
};

export class DataDisplay {
  private liveDataGrid: HTMLElement;
  private sourceTypeElement: HTMLSpanElement;
  private currentSourceType: FitnessData['sourceType'] | null = null;
  private liveFieldElements: Map<string, HTMLSpanElement> = new Map();
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  private ftmsElements: {
    power: HTMLSpanElement;
    cadence: HTMLSpanElement;
    hr: HTMLSpanElement;
  };

  constructor(private parser: DeviceSpecParser) {
    this.liveDataGrid = this.getElement('live-data-grid');
    this.sourceTypeElement = this.getElement('source-type') as HTMLSpanElement;

    this.ftmsElements = {
      power:   this.getElement('ftms-power')   as HTMLSpanElement,
      cadence: this.getElement('ftms-cadence') as HTMLSpanElement,
      hr:      this.getElement('ftms-hr')      as HTMLSpanElement,
    };
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Data display element not found: ${id}`);
    return element;
  }

  updateSettings(settings: AppSettings): void {
    const modeChanged = settings.liveDataMode !== this.settings.liveDataMode;
    this.settings = settings;
    if (this.currentSourceType && modeChanged) {
      this.buildLiveDataSection(this.currentSourceType);
    }
  }

  update(data: FitnessData): void {
    if (data.sourceType && data.sourceType !== this.currentSourceType) {
      this.buildLiveDataSection(data.sourceType);
      this.currentSourceType = data.sourceType;
      this.sourceTypeElement.textContent = this.parser.getSpecName(String(data.sourceType));
    }

    this.updateLiveData(data);
    this.updateFtmsOutput(this.convertToFtms(data));
  }

  private getFields(sourceType: FitnessData['sourceType']): FieldConfig[] {
    if (this.settings.liveDataMode === 'ftms') {
      return buildFieldConfigs(FTMS_ONLY_FIELDS);
    }
    const fieldNames = this.parser.getDisplayFields(String(sourceType ?? ''));
    return buildFieldConfigs(fieldNames);
  }

  private buildLiveDataSection(sourceType: FitnessData['sourceType']): void {
    const fields = this.getFields(sourceType);
    this.liveFieldElements.clear();
    this.liveDataGrid.innerHTML = '';

    if (fields.length === 0) {
      this.liveDataGrid.innerHTML = '<div class="no-data">Unknown device type</div>';
      return;
    }

    for (const field of fields) {
      const card = document.createElement('div');
      card.className = 'data-card';
      card.innerHTML = `
        <div class="data-label">${field.label}</div>
        <div class="data-value">
          <span id="live-${field.id}">--</span>
          <span class="data-unit">${field.unit}</span>
        </div>
      `;
      this.liveDataGrid.appendChild(card);

      const valueElement = card.querySelector(`#live-${field.id}`) as HTMLSpanElement;
      this.liveFieldElements.set(field.id, valueElement);
    }
  }

  private updateLiveData(data: FitnessData): void {
    for (const field of this.getFields(data.sourceType)) {
      const element = this.liveFieldElements.get(field.id);
      if (element) {
        element.textContent = field.getValue(data);
      }
    }
  }

  private updateFtmsOutput(output: FtmsOutput): void {
    this.ftmsElements.power.textContent   = Math.round(output.power).toString();
    this.ftmsElements.cadence.textContent = Math.round(output.cadence).toString();
    this.ftmsElements.hr.textContent      = output.heartRate !== undefined ? Math.round(output.heartRate).toString() : '--';
  }

  private convertToFtms(data: FitnessData): FtmsOutput {
    return {
      power:     data.power ?? 0,
      cadence:   data.cadence ?? 0,
      heartRate: data.heartRate,
    };
  }

  reset(): void {
    this.currentSourceType = null;
    this.liveFieldElements.clear();
    this.liveDataGrid.innerHTML = '<div class="no-data">Connect a device to see live data</div>';
    this.sourceTypeElement.textContent = '--';

    this.ftmsElements.power.textContent   = '--';
    this.ftmsElements.cadence.textContent = '--';
    this.ftmsElements.hr.textContent      = '--';
  }
}
