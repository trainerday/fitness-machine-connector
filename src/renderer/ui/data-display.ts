/**
 * Data display UI component - shows live fitness data and FTMS output
 */

import { FitnessData, FtmsOutput } from '../../shared/types';

export class DataDisplay {
  // Live data elements
  private liveElements: {
    power: HTMLSpanElement;
    cadence: HTMLSpanElement;
    hr: HTMLSpanElement;
    speed: HTMLSpanElement;
    distance: HTMLSpanElement;
    calories: HTMLSpanElement;
    duration: HTMLSpanElement;
    gear: HTMLSpanElement;
    sourceType: HTMLSpanElement;
  };

  // FTMS output elements
  private ftmsElements: {
    power: HTMLSpanElement;
    cadence: HTMLSpanElement;
    hr: HTMLSpanElement;
    speed: HTMLSpanElement;
  };

  constructor() {
    this.liveElements = {
      power: this.getElement('live-power'),
      cadence: this.getElement('live-cadence'),
      hr: this.getElement('live-hr'),
      speed: this.getElement('live-speed'),
      distance: this.getElement('live-distance'),
      calories: this.getElement('live-calories'),
      duration: this.getElement('live-duration'),
      gear: this.getElement('live-gear'),
      sourceType: this.getElement('source-type'),
    };

    this.ftmsElements = {
      power: this.getElement('ftms-power'),
      cadence: this.getElement('ftms-cadence'),
      hr: this.getElement('ftms-hr'),
      speed: this.getElement('ftms-speed'),
    };
  }

  private getElement(id: string): HTMLSpanElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Data display element not found: ${id}`);
    }
    return element as HTMLSpanElement;
  }

  /**
   * Update the display with new fitness data
   */
  update(data: FitnessData): void {
    // Update live data section
    this.updateLiveData(data);

    // Convert to FTMS and update FTMS output section
    const ftmsOutput = this.convertToFtms(data);
    this.updateFtmsOutput(ftmsOutput);
  }

  /**
   * Update the live data display with raw incoming data
   */
  private updateLiveData(data: FitnessData): void {
    // Source type badge
    if (data.sourceType) {
      this.liveElements.sourceType.textContent = data.sourceType;
    }

    // Core metrics
    if (data.power !== undefined) {
      this.liveElements.power.textContent = Math.round(data.power).toString();
    }
    if (data.cadence !== undefined) {
      this.liveElements.cadence.textContent = Math.round(data.cadence).toString();
    }
    if (data.heartRate !== undefined) {
      this.liveElements.hr.textContent = Math.round(data.heartRate).toString();
    }
    if (data.speed !== undefined) {
      this.liveElements.speed.textContent = data.speed.toFixed(1);
    }

    // Extended metrics
    if (data.distance !== undefined) {
      this.liveElements.distance.textContent = data.distance.toFixed(2);
    }
    if (data.calories !== undefined) {
      this.liveElements.calories.textContent = Math.round(data.calories).toString();
    }
    if (data.duration !== undefined) {
      this.liveElements.duration.textContent = this.formatDuration(data.duration);
    }
    if (data.gear !== undefined) {
      this.liveElements.gear.textContent = data.gear.toString();
    }
  }

  /**
   * Update the FTMS output display
   */
  private updateFtmsOutput(output: FtmsOutput): void {
    this.ftmsElements.power.textContent = Math.round(output.power).toString();
    this.ftmsElements.cadence.textContent = Math.round(output.cadence).toString();
    this.ftmsElements.speed.textContent = output.speed.toFixed(1);

    if (output.heartRate !== undefined) {
      this.ftmsElements.hr.textContent = Math.round(output.heartRate).toString();
    }
  }

  /**
   * Convert raw fitness data to FTMS output format.
   * Calculates speed from power if not available.
   */
  private convertToFtms(data: FitnessData): FtmsOutput {
    const power = data.power ?? 0;
    const cadence = data.cadence ?? 0;

    // Calculate speed from power if not provided
    // Using a simple formula: speed (km/h) = power^0.5 * factor
    // This approximates typical cycling physics
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
    };
  }

  /**
   * Format duration in seconds to MM:SS or HH:MM:SS
   */
  private formatDuration(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Reset all values to default state
   */
  reset(): void {
    // Reset live data
    this.liveElements.power.textContent = '--';
    this.liveElements.cadence.textContent = '--';
    this.liveElements.hr.textContent = '--';
    this.liveElements.speed.textContent = '--';
    this.liveElements.distance.textContent = '--';
    this.liveElements.calories.textContent = '--';
    this.liveElements.duration.textContent = '--';
    this.liveElements.gear.textContent = '--';
    this.liveElements.sourceType.textContent = '--';

    // Reset FTMS output
    this.ftmsElements.power.textContent = '--';
    this.ftmsElements.cadence.textContent = '--';
    this.ftmsElements.hr.textContent = '--';
    this.ftmsElements.speed.textContent = '--';
  }
}
