/**
 * Data display UI component - shows fitness metrics (power, cadence, HR, speed)
 */

import { FitnessData } from '../../shared/types';

export class DataDisplay {
  private powerValue: HTMLSpanElement;
  private cadenceValue: HTMLSpanElement;
  private hrValue: HTMLSpanElement;
  private speedValue: HTMLSpanElement;

  constructor() {
    this.powerValue = this.getElement('power-value');
    this.cadenceValue = this.getElement('cadence-value');
    this.hrValue = this.getElement('hr-value');
    this.speedValue = this.getElement('speed-value');
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
    if (data.power !== undefined) {
      this.powerValue.textContent = Math.round(data.power).toString();
    }
    if (data.cadence !== undefined) {
      this.cadenceValue.textContent = Math.round(data.cadence).toString();
    }
    if (data.heartRate !== undefined) {
      this.hrValue.textContent = Math.round(data.heartRate).toString();
    }
    if (data.speed !== undefined) {
      this.speedValue.textContent = data.speed.toFixed(1);
    }
  }

  /**
   * Reset all values to default state
   */
  reset(): void {
    this.powerValue.textContent = '--';
    this.cadenceValue.textContent = '--';
    this.hrValue.textContent = '--';
    this.speedValue.textContent = '--';
  }
}
