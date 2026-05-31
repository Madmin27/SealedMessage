"use client";

import { useNetwork, useSwitchNetwork } from '../lib/wagmiCompat';
import { supportedChains } from '../lib/chains';
import { useState, useRef, useEffect } from 'react';

export function NetworkSwitcher() {
  const { chain } = useNetwork();
  const { switchNetwork, switchNetworkAsync, isLoading } = useSwitchNetwork();
  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const testnets = Object.entries(supportedChains).filter(([_, config]) => config.testnet);
  const mainnets = Object.entries(supportedChains).filter(([_, config]) => !config.testnet);

  const displayChains = showAll 
    ? [...testnets, ...mainnets] 
    : testnets;

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative z-50" ref={dropdownRef}>
      {/* Compact Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="flex w-full items-center justify-between rounded-2xl border border-cyber-blue/20 bg-brand-panel/80 px-4 py-3 shadow-glow-blue transition hover:border-sunset/60 hover:bg-brand-panel"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌐</span>
          <div className="text-left">
            <p className="text-sm font-semibold text-text-light">Network Selection</p>
            <p className="text-xs text-text-light/55">
              {mounted && chain ? (
                <>Active: <span className="font-semibold text-brand-cyan">{chain.name}</span></>
              ) : (
                'Select network'
              )}
            </p>
          </div>
        </div>
        <svg
          className={`h-5 w-5 text-brand-cyan/80 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Panel - Only render after mount to prevent hydration mismatch */}
      {mounted && isOpen && (
  <div 
          className="absolute left-0 right-0 z-[100] mt-2 max-h-[500px] overflow-y-auto rounded-2xl border border-cyber-blue/30 bg-brand-panel shadow-glow-blue-strong"
          style={{ minHeight: '200px' }}
        >
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-cyber-blue/20 bg-brand-panel px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-brand-cyan">Network Selection</h3>
              <button
                onClick={() => setShowAll(!showAll)}
                className="rounded-full border border-cyber-blue/20 bg-midnight px-3 py-1 text-xs text-text-light/75 hover:border-sunset/50 hover:text-white"
              >
                {showAll ? '🧪 Testnets Only' : '🌐 All Networks'}
              </button>
            </div>
          </div>

          {/* Chain List */}
          <div className="p-2">
            {displayChains.map(([key, chainConfig]) => {
              const isActive = chain?.id === chainConfig.id;
              const hasContract = chainConfig.contractAddress !== '0x0000000000000000000000000000000000000000';
              const targetChainId = chainConfig.id;

              return (
                <button
                  key={key}
                  onClick={() => {
                    if (isActive) {
                      return;
                    }

                    const attemptSwitch = async () => {
                      const targetChainHex = `0x${targetChainId.toString(16)}`;

                      if (switchNetworkAsync) {
                        try {
                          await switchNetworkAsync(targetChainId);
                          return;
                        } catch (err) {
                          console.warn('⚠️ switchNetworkAsync failed, falling back to direct request', err);
                        }
                      }

                      const ethereum = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
                      if (ethereum?.request) {
                        try {
                          await ethereum.request({
                            method: 'wallet_switchEthereumChain',
                            params: [{ chainId: targetChainHex }]
                          });
                          return;
                        } catch (err: any) {
                          // Error code 4902 or message indicates chain not added to wallet yet
                          const isChainNotAdded = err?.code === 4902 || 
                                                 (err?.message && err.message.includes('Unrecognized chain ID'));
                          
                          if (isChainNotAdded) {
                            try {
                              // Prepare network parameters
                              const rpcUrl = chainConfig.rpcUrls.infura || chainConfig.rpcUrls.default;
                              await ethereum.request({
                                method: 'wallet_addEthereumChain',
                                params: [{
                                  chainId: targetChainHex,
                                  chainName: chainConfig.name,
                                  nativeCurrency: {
                                    name: chainConfig.nativeCurrency.name,
                                    symbol: chainConfig.nativeCurrency.symbol,
                                    decimals: 18 // MetaMask only accepts 18 decimals for native currency
                                  },
                                  rpcUrls: [rpcUrl],
                                  blockExplorerUrls: chainConfig.blockExplorer ? [chainConfig.blockExplorer] : undefined
                                }]
                              });
                              console.log('✅ Network added to wallet:', chainConfig.name);

                              try {
                                await ethereum.request({
                                  method: 'wallet_switchEthereumChain',
                                  params: [{ chainId: targetChainHex }]
                                });
                                console.log('🔁 Switched to newly added network:', chainConfig.name);
                              } catch (switchAfterAddError) {
                                console.warn('⚠️ Failed to switch after adding network', switchAfterAddError);
                              }
                              return;
                            } catch (addErr) {
                              console.error('❌ Failed to add network:', addErr);
                            }
                          } else {
                            console.warn('⚠️ Wallet refused to switch networks', err);
                          }
                        }
                      }

                      console.warn('⚠️ Cannot switch:', {
                        isActive,
                        hasSwitchNetwork: !!switchNetwork,
                        hasFallback: Boolean(ethereum?.request)
                      });
                    };

                    void attemptSwitch().finally(() => {
                      setIsOpen(false);
                    });
                  }}
                  disabled={isActive || isLoading}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 mb-2 text-left transition ${
                    isActive
                      ? 'border-brand-cyan/60 bg-cyber-blue/10 shadow-glow-blue'
                      : 'border-cyber-blue/20 bg-midnight/80 hover:border-sunset/50 hover:bg-brand-panel cursor-pointer'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${
                        isActive
                            ? 'text-brand-cyan'
                          : hasContract
                            ? 'text-text-light'
                            : 'text-text-light/35'
                      }`}>
                        {chainConfig.name}
                      </span>
                      {isActive && (
                        <span className="text-brand-cyan">✓</span>
                      )}
                      {hasContract && !isActive && (
                        <span className="text-sunset text-xs">●</span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={`text-xs ${hasContract ? 'text-text-light/55' : 'text-text-light/30'}`}>
                        {chainConfig.nativeCurrency.symbol}
                      </span>

                      {chainConfig.testnet && (
                        <span className={`rounded px-1.5 py-0.5 text-xs ${
                          hasContract
                            ? 'bg-sunset/15 text-brand-orange-soft'
                            : 'bg-midnight/40 text-text-light/35'
                        }`}>
                          Testnet
                        </span>
                      )}
                      
                      {hasContract ? (
                        <span className="flex items-center gap-1 rounded bg-cyber-blue/10 px-1.5 py-0.5 text-xs text-brand-cyan">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-cyan"></span>
                          Deployed
                        </span>
                      ) : (
                        <span className="rounded bg-midnight/40 px-1.5 py-0.5 text-xs text-text-light/45">
                          🚧 Contract not deployed yet
                        </span>
                      )}
                    </div>
                  </div>

                  {isLoading && (
                    <svg className="h-4 w-4 animate-spin text-sunset" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer Info */}
          {!showAll && mainnets.length > 0 && (
            <div className="border-t border-cyber-blue/20 bg-cyber-blue/10 px-4 py-3">
              <p className="text-xs text-brand-cyan">
                💡 <strong>{mainnets.length} mainnets</strong> available. Click the &quot;All Networks&quot; button.
              </p>
            </div>
          )}

          <div className="border-t border-slate-700 bg-slate-800/50 px-4 py-3">
            <h4 className="text-xs font-semibold text-slate-300">📌 Note:</h4>
            <ul className="mt-1 space-y-1 text-xs text-slate-400">
              <li>• You can claim free tokens on testnets (faucet)</li>
              <li>• Mainnets spend real funds</li>
              <li>• Deploy the factory contract separately on each network</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
