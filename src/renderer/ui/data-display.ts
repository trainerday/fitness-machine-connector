/**
 * Data display UI component - shows live fitness data and FTMS output
 *
 * Live Data: Dynamically shows fields specific to the connected device type
 * FTMS Output: Shows the translated FTMS Indoor Bike Data fields
 */

import { FitnessData, FtmsOutput } from '../../shared/types';

/**
 * Field configuration for a data card
 */
interface FieldConfig {
  id: string;
  label: string;
  unit: string;
  getValue: (data: FitnessData) => string;
}

/**
 * Device-specific field configurations
 */
const KEISER_M3I_FIELDS: FieldConfig[] = [
  { id: 'power', label: 'Power', unit: 'W', getValue: (d) => d.power !== undefined ? Math.round(d.power).toString() : '--' },
  { id: 'cadence', label: 'Cadence', unit: 'RPM', getValue: (d) => d.cadence !== undefined ? Math.round(d.cadence).toString() : '--' },
  { id: 'hr', label: 'Heart Rate', unit: 'BPM', getValue: (d) => d.heartRate !== undefined ? Math.round(d.heartRate).toString() : '--' },
  { id: 'calories', label: 'Calories', unit: 'kcal', getValue: (d) => d.calories !== undefined ? Math.round(d.calories).toString() : '--' },
  { id: 'duration', label: 'Duration', unit: '', getValue: (d) => d.duration !== undefined ? formatDuration(d.duration) : '--' },
  { id: 'distance', label: 'Distance', unit: 'mi', getValue: (d) => d.distance !== undefined ? (d.distance / 1.60934).toFixed(2) : '--' }, // Convert back to miles for display
  { id: 'gear', label: 'Gear', unit: '', getValue: (d) => d.gear !== undefined ? d.gear.toString() : '--' },
];

const FTMS_FIELDS: FieldConfig[] = [
  { id: 'speed', label: 'Inst. Speed', unit: 'km/h', getValue: (d) => d.speed !== undefined ? d.speed.toFixed(1) : '--' },
  { id: 'cadence', label: 'Inst. Cadence', unit: 'RPM', getValue: (d) => d.cadence !== undefined ? Math.round(d.cadence).toString() : '--' },
  { id: 'power', label: 'Inst. Power', unit: 'W', getValue: (d) => d.power !== undefined ? Math.round(d.power).toString() : '--' },
  { id: 'hr', label: 'Heart Rate', unit: 'BPM', getValue: (d) => d.heartRate !== undefined ? Math.round(d.heartRate).toString() : '--' },
  { id: 'distance', label: 'Total Distance', unit: 'm', getValue: (d) => d.distance !== undefined ? Math.round(d.distance * 1000).toString() : '--' },
  { id: 'calories', label: 'Total Energy', unit: 'kcal', getValue: (d) => d.calories !== undefined ? Math.round(d.calories).toString() : '--' },
  { id: 'resistance', label: 'Resistance', unit: '', getValue: (d) => d.resistance !== undefined ? d.resistance.toFixed(1) : '--' },
  { id: 'duration', label: 'Elapsed Time', unit: '', getValue: (d) => d.duration !== undefined ? formatDuration(d.duration) : '--' },
];

const CYCLING_POWER_FIELDS: FieldConfig[] = [
  { id: 'power', label: 'Inst. Power', unit: 'W', getValue: (d) => d.power !== undefined ? Math.round(d.power).toString() : '--' },
];

const HEART_RATE_FIELDS: FieldConfig[] = [
  { id: 'hr', label: 'Heart Rate', unit: 'BPM', getValue: (d) => d.heartRate !== undefined ? Math.round(d.heartRate).toString() : '--' },
];

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
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
 * Get field configuration for a source type
 */
function getFieldsForSource(sourceType: FitnessData['sourceType']): FieldConfig[] {
  switch (sourceType) {
    case 'keiser-m3i':
      return KEISER_M3I_FIELDS;
    case 'ftms':
      return FTMS_FIELDS;
    case 'cycling-power':
      return CYCLING_POWER_FIELDS;
    case 'heart-rate':
      return HEART_RATE_FIELDS;
    default:
      return [];
  }
}

/**
 * Get display name for a source type
 */
function getSourceDisplayName(sourceType: FitnessData['sourceType']): string {
  switch (sourceType) {
    case 'keiser-m3i':
      return 'Keiser M3i';
    case 'ftms':
      return 'FTMS';
    case 'cycling-power':
      return 'Cycling Power';
    case 'heart-rate':
      return 'Heart Rate';
    default:
      return '--';
  }
}

export class DataDisplay {
  private liveDataGrid: HTMLElement;
  private sourceTypeElement: HTMLSpanElement;
  private currentSourceType: FitnessData['sourceType'] | null = null;
  private liveFieldElements: Map<string, HTMLSpanElement> = new Map();

  // FTMS output elements
  private ftmsElements: {
    speed: HTMLSpanElement;
    cadence: HTMLSpanElement;
    power: HTMLSpanElement;
    hr: HTMLSpanElement;
    distance: HTMLSpanElement;
    calories: HTMLSpanElement;
    resistance: HTMLSpanElement;
    elapsed: HTMLSpanElement;
  };

  constructor() {
    this.liveDataGrid = this.getElement('live-data-grid');
    this.sourceTypeElement = this.getElement('source-type') as HTMLSpanElement;

    this.ftmsElements = {
      speed: this.getElement('ftms-speed') as HTMLSpanElement,
      cadence: this.getElement('ftms-cadence') as HTMLSpanElement,
      power: this.getElement('ftms-power') as HTMLSpanElement,
      hr: this.getElement('ftms-hr') as HTMLSpanElement,
      distance: this.getElement('ftms-distance') as HTMLSpanElement,
      calories: this.getElement('ftms-calories') as HTMLSpanElement,
      resistance: this.getElement('ftms-resistance') as HTMLSpanElement,
      elapsed: this.getElement('ftms-elapsed') as HTMLSpanElement,
    };
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Data display element not found: ${id}`);
    }
    return element;
  }

  /**
   * Update the display with new fitness data
   */
  update(data: FitnessData): void {
    // Check if source type changed - rebuild live data section if needed
    if (data.sourceType && data.sourceType !== this.currentSourceType) {
      this.buildLiveDataSection(data.sourceType);
      this.currentSourceType = data.sourceType;
      this.sourceTypeElement.textContent = getSourceDisplayName(data.sourceType);
    }

    // Update live data section
    this.updateLiveData(data);

    // Convert to FTMS and update FTMS output section
    const ftmsOutput = this.convertToFtms(data);
    this.updateFtmsOutput(ftmsOutput);
  }

  /**
   * Build the live data section dynamically based on source type
   */
  private buildLiveDataSection(sourceType: FitnessData['sourceType']): void {
    const fields = getFieldsForSource(sourceType);
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

  /**
   * Update the live data display with raw incoming data
   */
  private updateLiveData(data: FitnessData): void {
    const fields = getFieldsForSource(data.sourceType);

    for (const field of fields) {
      const element = this.liveFieldElements.get(field.id);
      if (element) {
        element.textContent = field.getValue(data);
      }
    }
  }

  /**
   * Update the FTMS output display
   */
  private updateFtmsOutput(output: FtmsOutput): void {
    this.ftmsElements.speed.textContent = output.speed.toFixed(1);
    this.ftmsElements.cadence.textContent = Math.round(output.cadence).toString();
    this.ftmsElements.power.textContent = Math.round(output.power).toString();
    this.ftmsElements.hr.textContent = output.heartRate !== undefined ? Math.round(output.heartRate).toString() : '--';
    this.ftmsElements.distance.textContent = output.distance !== undefined ? Math.round(output.distance).toString() : '--';
    this.ftmsElements.calories.textContent = output.calories !== undefined ? Math.round(output.calories).toString() : '--';
    this.ftmsElements.resistance.textContent = output.resistance !== undefined ? output.resistance.toFixed(1) : '--';
    this.ftmsElements.elapsed.textContent = output.elapsedTime !== undefined ? formatDuration(output.elapsedTime) : '--';
  }

  /**
   * Convert raw fitness data to FTMS output format.
   * Calculates speed from power if not available.
   */
  private convertToFtms(data: FitnessData): FtmsOutput {
    const power = data.power ?? 0;
    const cadence = data.cadence ?? 0;

    // Calculate speed from power if not provided
    // Using a simple formula based on typical cycling physics
    let speed = data.speed;
    if (speed === undefined && power > 0) {
      // Simple estimation: ~30 km/h at 200W for a typical rider
      // Formula: speed = (power / 6.5)^0.5 * 3.6
      speed = Math.sqrt(power / 6.5) * 3.6;
    }

    return {
      power,
      cadence,
      speed: speed ?? 0,
      heartRate: data.heartRate,
      distance: data.distance ? data.distance * 1000 : undefined, // Convert km to meters
      calories: data.calories,
      resistance: data.resistance,
      elapsedTime: data.duration,
    };
  }

  /**
   * Reset all values to default state
   */
  reset(): void {
    // Reset live data section
    this.currentSourceType = null;
    this.liveFieldElements.clear();
    this.liveDataGrid.innerHTML = '<div class="no-data">Connect a device to see live data</div>';
    this.sourceTypeElement.textContent = '--';

    // Reset FTMS output
    this.ftmsElements.speed.textContent = '--';
    this.ftmsElements.cadence.textContent = '--';
    this.ftmsElements.power.textContent = '--';
    this.ftmsElements.hr.textContent = '--';
    this.ftmsElements.distance.textContent = '--';
    this.ftmsElements.calories.textContent = '--';
    this.ftmsElements.resistance.textContent = '--';
    this.ftmsElements.elapsed.textContent = '--';
  }
}
