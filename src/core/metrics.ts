export class Metrics {
  createdChannels = 0;
  deletedChannels = 0;
  activeTickets = 0;
  reconnects = 0;

  renderPrometheus(): string {
    return [
      `created_channels_total ${this.createdChannels}`,
      `deleted_channels_total ${this.deletedChannels}`,
      `active_tickets ${this.activeTickets}`,
      `reconnects_total ${this.reconnects}`
    ].join('\n');
  }
}
