import './App.css';
import { ApiStatusBanner, ApiStatusProvider } from './components/ApiStatusProvider';
import IntegratedMarsExplorer from './components/IntegratedMarsExplorer';

function App() {
  return (
    <ApiStatusProvider>
      <IntegratedMarsExplorer initialView="globe" />
      <ApiStatusBanner />
    </ApiStatusProvider>
  );
}

export default App;
