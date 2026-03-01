/**
 * Activity log UI component - displays timestamped log entries
 */

export class ActivityLog {
  private container: HTMLDivElement;
  private advancedToggleBtn: HTMLButtonElement | null = null;
  private advancedContent: HTMLDivElement | null = null;
  private isExpanded: boolean = false;

  constructor(containerId: string) {
    const element = document.getElementById(containerId);
    if (!element) {
      throw new Error(`Activity log container not found: ${containerId}`);
    }
    this.container = element as HTMLDivElement;
    this.setupAdvancedToggle();
  }

  /**
   * Set up the expand/collapse toggle for the Advanced section
   */
  private setupAdvancedToggle(): void {
    this.advancedToggleBtn = document.getElementById('advanced-toggle') as HTMLButtonElement;
    this.advancedContent = document.getElementById('advanced-content') as HTMLDivElement;
    if (this.advancedToggleBtn) {
      this.advancedToggleBtn.addEventListener('click', () => this.toggle());
    }
  }

  /**
   * Toggle the Advanced section visibility
   */
  private toggle(): void {
    this.isExpanded = !this.isExpanded;
    this.advancedContent?.classList.toggle('collapsed', !this.isExpanded);
    this.advancedToggleBtn?.classList.toggle('expanded', this.isExpanded);
  }

  /**
   * Expand the Advanced section
   */
  expand(): void {
    this.isExpanded = true;
    this.advancedContent?.classList.remove('collapsed');
    this.advancedToggleBtn?.classList.add('expanded');
  }

  /**
   * Collapse the Advanced section
   */
  collapse(): void {
    this.isExpanded = false;
    this.advancedContent?.classList.add('collapsed');
    this.advancedToggleBtn?.classList.remove('expanded');
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
