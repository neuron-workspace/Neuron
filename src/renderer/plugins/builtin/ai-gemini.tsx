import { Sparkles } from 'lucide-react';
import type { PluginModule } from '../types';
import AssistantPanel from './AssistantPanel';

const aiGemini: PluginModule = {
  manifest: {
    id: 'ai-gemini',
    name: 'Gemini Assistant',
    version: '1.0.0',
    author: 'Neuron',
    description: 'Chat with Google Gemini models about the note you are editing. Calls the Gemini API through the desktop app.',
    category: 'ai',
    connector: { id: 'google', name: 'Gemini', description: 'Google Gemini models, with your API key.' },
    configSchema: [
      { key: 'apiKey', label: 'Gemini API key', type: 'password', placeholder: 'AIzaSy…', description: 'Stored in the main process. It is never readable by the app UI or by any plugin, including this one.' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'gemini-1.5-flash', description: 'Optional. Defaults to gemini-1.5-flash.' },
    ],
  },
  activate(host) {
    host.registerPanel({
      id: 'ai-gemini.assistant',
      title: 'Gemini',
      icon: Sparkles,
      render: (runtime) => (
        <AssistantPanel
          host={runtime}
          provider="google"
          defaultModel="gemini-1.5-flash"
          emptyHint="Ask Gemini to summarize, rewrite, or expand the note you have open. Set up Gemini in Settings › Connectors first."
        />
      ),
    });
  },
};

export default aiGemini;
