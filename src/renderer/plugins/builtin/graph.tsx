import { Share2 } from 'lucide-react';
import type { PluginModule } from '../types';
import GraphCanvas from '../../components/GraphCanvas';

const graph: PluginModule = {
  manifest: {
    id: 'graph',
    name: 'Graph panel',
    version: '1.0.0',
    author: 'Neuron',
    description: 'The workspace graph as a panel you can dock, stack or split like any other.',
    category: 'integration',
  },
  activate(host) {
    host.registerPanel({
      id: 'graph.panel',
      title: 'Graph',
      icon: Share2,
      render: (runtime) => (
        <div className="h-full">
          <GraphCanvas notesData={runtime.notesData} scope="repo" folder="" selectedNote={runtime.activeNote}
            onSelectNote={runtime.openNote} emptyHint="Links between notes appear here." />
        </div>
      ),
    });
  },
};

export default graph;
