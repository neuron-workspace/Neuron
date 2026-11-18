import { TerminalSquare } from 'lucide-react';
import type { PluginModule } from '../types';
import TerminalPanel from '../../components/TerminalPanel';

const terminal: PluginModule = {
  manifest: {
    id: 'terminal',
    name: 'Workspace Terminal',
    version: '2.0.0',
    author: 'Neuron',
    description: 'Full interactive shell (PTY) for workspace-aware command-line work.',
    category: 'integration',
  },
  activate(host) {
    host.registerPanel({
      id: 'terminal.panel',
      title: 'Terminal',
      icon: TerminalSquare,
      location: 'bottom',
      // The panel rail's terminal. Named, so it keeps its own shell and
      // scrollback rather than sharing with a terminal a workspace layout
      // happens to declare.
      render: () => <TerminalPanel />,
    });
  },
};

export default terminal;
