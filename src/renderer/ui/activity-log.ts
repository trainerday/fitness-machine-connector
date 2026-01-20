/**
 * Activity log UI component - displays timestamped log entries
 */

export class ActivityLog {
  private container: HTMLDivElement;

  constructor(containerId: string) {
    const element = document.getElementById(containerId);
    if (!element) {
      throw new Error(`Activity log container not found: ${containerId}`);
    }
    this.container = element as HTMLDivElement;
  }

  /**
   * Add a timestamped log entry
   */
  log(message: string): void {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    this.container.appendChild(entry);
    this.container.scrollTop = this.container.scrollHeight;
  }

  /**
   * Clear all log entries
   */
  clear(): void {
    this.container.innerHTML = '';
  }
}
