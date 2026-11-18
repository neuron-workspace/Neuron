import { Cpu } from 'lucide-react';
import type { PluginModule } from '../types';
import AssistantPanel from './AssistantPanel';

const aiLocal: PluginModule = {
  manifest: {
    id: 'ai-local',
    name: 'Local Model',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Chat with a local model (Ollama or any OpenAI-compatible endpoint) — your notes never leave the machine.',
    category: 'ai',
    connector: { id: 'local', name: 'Local model', description: 'A model running on this machine, such as Ollama, at an endpoint you set.' },
    configSchema: [
      { key: 'endpoint', label: 'Endpoint', type: 'url', placeholder: 'http://localhost:11434/v1/chat/completions', description: 'OpenAI-compatible chat completions URL.' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'llama3', description: 'Model name served by your local runtime.' },
    ],
  },
  activate(host) {
    host.registerPanel({
      id: 'ai-local.assistant',
      title: 'Local',
      icon: Cpu,
      render: (runtime) => (
        <AssistantPanel
          host={runtime}
          provider="local"
          defaultModel={runtime.config.model || 'llama3'}
          emptyHint="Chat with a model running on your machine. Set its endpoint and model name in Settings › Connectors › Local model."
        />
      ),
    });
  },
};

export default aiLocal;
