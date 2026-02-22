/**
 * Activity log UI component - displays timestamped log entries
 */

export class ActivityLog {
  private container: HTMLDivElement;
  private toggleBtn: HTMLButtonElement | null = null;
  private isExpanded: boolean = false;

  constructor(containerId: string) {
    const element = document.getElementById(containerId);
    if (!element) {
      throw new Error(`Activity log container not found: ${containerId}`);
    }
    this.container = element as HTMLDivElement;
    this.setupToggle();
  }

  /**
   * Set up the expand/collapse toggle
   */
  private setupToggle(): void {
    this.toggleBtn = document.getElementById('log-toggle') as HTMLButtonElement;
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.toggle());
    }
  }

  /**
   * Toggle the activity log visibility
   */
  private toggle(): void {
    this.isExpanded = !this.isExpanded;
    this.container.classList.toggle('collapsed', !this.isExpanded);
    this.toggleBtn?.classList.toggle('expanded', this.isExpanded);
  }

  /**
   * Expand the activity log
   */
  expand(): void {
    this.isExpanded = true;
    this.container.classList.remove('collapsed');
    this.toggleBtn?.classList.add('expanded');
  }

  /**
   * Collapse the activity log
   */
  collapse(): void {
    this.isExpanded = false;
    this.container.classList.add('collapsed');
    this.toggleBtn?.classList.remove('expanded');
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
