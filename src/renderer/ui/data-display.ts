/**
 * Data display UI component - shows live fitness data and FTMS output
 *
 * Live Data: Dynamically shows fields specific to the connected device type
 * FTMS Output: Shows the core fields (Power, Cadence, HR) with expandable additional fields
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

/** Core fields shown for all device types */
const CORE_FIELDS: FieldConfig[] = [
  { id: 'power', label: 'Power', unit: 'W', getValue: (d) => d.power !== undefined ? Math.round(d.power).toString() : '--' },
  { id: 'cadence', label: 'Cadence', unit: 'RPM', getValue: (d) => d.cadence !== undefined ? Math.round(d.cadence).toString() : '--' },
  { id: 'hr', label: 'Heart Rate', unit: 'BPM', getValue: (d) => d.heartRate !== undefined ? Math.round(d.heartRate).toString() : '--' },
];

/**
 * Get field configuration for a source type
 */
function getFieldsForSource(_sourceType: FitnessData['sourceType']): FieldConfig[] {
  return CORE_FIELDS;
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

  // FTMS output elements - core fields
  private ftmsElements: {
    power: HTMLSpanElement;
    cadence: HTMLSpanElement;
    hr: HTMLSpanElement;
    // Additional fields
    distance: HTMLSpanElement;
    calories: HTMLSpanElement;
    elapsed: HTMLSpanElement;
  };

  // Expandable section elements
  private toggleBtn: HTMLButtonElement;
  private expandIcon: HTMLSpanElement;
  private additionalFields: HTMLElement;
  private isExpanded: boolean = false;

  constructor() {
    this.liveDataGrid = this.getElement('live-data-grid');
    this.sourceTypeElement = this.getElement('source-type') as HTMLSpanElement;

    this.ftmsElements = {
      power: this.getElement('ftms-power') as HTMLSpanElement,
      cadence: this.getElement('ftms-cadence') as HTMLSpanElement,
      hr: this.getElement('ftms-hr') as HTMLSpanElement,
      distance: this.getElement('ftms-distance') as HTMLSpanElement,
      calories: this.getElement('ftms-calories') as HTMLSpanElement,
      elapsed: this.getElement('ftms-elapsed') as HTMLSpanElement,
    };

    // Set up expandable section
    this.toggleBtn = this.getElement('toggle-additional') as HTMLButtonElement;
    this.expandIcon = this.toggleBtn.querySelector('.expand-icon') as HTMLSpanElement;
    this.additionalFields = this.getElement('additional-fields');

    this.setupExpandToggle();
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Data display element not found: ${id}`);
    }
    return element;
  }

  /**
   * Set up the expand/collapse toggle for additional fields
   */
  private setupExpandToggle(): void {
    this.toggleBtn.addEventListener('click', () => {
      this.isExpanded = !this.isExpanded;

      if (this.isExpanded) {
        this.additionalFields.style.display = 'block';
        this.expandIcon.classList.add('expanded');
        this.toggleBtn.innerHTML = '<span class="expand-icon expanded">▶</span> Hide additional fields';
      } else {
        this.additionalFields.style.display = 'none';
        this.expandIcon.classList.remove('expanded');
        this.toggleBtn.innerHTML = '<span class="expand-icon">▶</span> Show additional fields';
      }
    });
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
    // Core fields
    this.ftmsElements.power.textContent = Math.round(output.power).toString();
    this.ftmsElements.cadence.textContent = Math.round(output.cadence).toString();
    this.ftmsElements.hr.textContent = output.heartRate !== undefined ? Math.round(output.heartRate).toString() : '--';

    // Additional fields
    this.ftmsElements.distance.textContent = output.distance !== undefined ? Math.round(output.distance).toString() : '--';
    this.ftmsElements.calories.textContent = output.calories !== undefined ? Math.round(output.calories).toString() : '--';
    this.ftmsElements.elapsed.textContent = output.elapsedTime !== undefined ? formatDuration(output.elapsedTime) : '--';
  }

  /**
   * Convert raw fitness data to FTMS output format.
   * Only passes through data that the device provides - no calculations.
   */
  private convertToFtms(data: FitnessData): FtmsOutput {
    return {
      power: data.power ?? 0,
      cadence: data.cadence ?? 0,
      heartRate: data.heartRate,
      distance: data.distance ? data.distance * 1000 : undefined, // Convert km to meters
      calories: data.calories,
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

    // Reset FTMS output - core fields
    this.ftmsElements.power.textContent = '--';
    this.ftmsElements.cadence.textContent = '--';
    this.ftmsElements.hr.textContent = '--';

    // Reset FTMS output - additional fields
    this.ftmsElements.distance.textContent = '--';
    this.ftmsElements.calories.textContent = '--';
    this.ftmsElements.elapsed.textContent = '--';

    // Collapse additional fields
    this.isExpanded = false;
    this.additionalFields.style.display = 'none';
    this.toggleBtn.innerHTML = '<span class="expand-icon">▶</span> Show additional fields';
  }
}
