import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity } from 'lucide-react';

export function NetworkStatusPanel() {
  const [capabilities, setCapabilities] = useState<{ nat_type: string, external_ip: string | null, ipv6_capable: boolean } | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const result = await invoke<any>('get_network_capabilities');
        setCapabilities(result);
      } catch (err) {
        console.error('Failed to grab network caps:', err);
      }
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-3 bg-surface-h text-text-muted text-xs border-t border-border-subtle flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1 text-text">
        <Activity size={14} className="text-accent" />
        <span className="font-medium tracking-wide">Network Health</span>
      </div>
      <div className="flex justify-between">
        <span>NAT Type:</span>
        <span className="text-text font-mono truncate">{capabilities?.nat_type || 'Scanning...'}</span>
      </div>
      <div className="flex justify-between">
        <span>External:</span>
        <span className="text-text font-mono truncate">{capabilities?.external_ip || '--'}</span>
      </div>
      <div className="flex justify-between">
        <span>IPv6 Ready:</span>
        <span className="text-text font-mono truncate">{capabilities?.ipv6_capable ? 'Yes' : 'No'}</span>
      </div>
    </div>
  );
}
