'use client';

import type { EditorConfig } from '../../config/EditorConfig';
import type { DetailedValidationResult } from '../EditorCore';
import { Section } from './shared';

export interface ValidatePanelProps {
  config: EditorConfig;
  validationResult?: DetailedValidationResult;
  onValidate: () => void;
  onAutoFix?: () => void;
}

export function ValidatePanel({
  config,
  validationResult,
  onValidate,
  onAutoFix,
}: ValidatePanelProps) {
  const theme = config.theme;
  const hasResult = validationResult?.timestamp !== undefined;
  const isValidating = validationResult?.isValidating ?? false;
  const isValid = validationResult?.valid ?? true;
  const issues = validationResult?.issues ?? [];
  const stats = validationResult?.stats;
  const navmeshStats = validationResult?.navmeshStats;

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const hasFixes = issues.some(i => i.suggestedFix);

  return (
    <div className="space-y-3">
      {/* Validate button */}
      <button
        onClick={onValidate}
        disabled={isValidating}
        className="w-full py-3 rounded-lg text-sm font-medium transition-all duration-300 ease-out flex items-center justify-center gap-2 group hover:scale-[1.02] active:scale-[0.98]"
        style={{
          backgroundColor: theme.primary,
          color: '#fff',
          opacity: isValidating ? 0.7 : 1,
          boxShadow: isValidating
            ? `0 2px 12px ${theme.primary}40`
            : `0 4px 16px ${theme.primary}50`,
        }}
      >
        {isValidating ? (
          <>
            <span className="animate-spin">⟳</span>
            Building Navmesh...
          </>
        ) : (
          <>
            <span className="transition-transform duration-200 group-hover:scale-125">✓</span>
            Validate Map
          </>
        )}
      </button>

      {/* Description */}
      <div
        className="text-[11px] leading-relaxed"
        style={{ color: theme.text.muted }}
      >
        Uses Recast Navigation (same as game) to verify all bases are connected. Includes decoration obstacles.
      </div>

      {/* Results */}
      {hasResult && !isValidating && (
        <div className="space-y-3">
          {/* Status banner */}
          <div
            className="p-4 rounded-lg flex items-start gap-3"
            style={{
              backgroundColor: isValid ? `${theme.success}15` : `${theme.error}15`,
              border: `1px solid ${isValid ? theme.success : theme.error}30`,
            }}
          >
            <span
              className="text-xl mt-0.5"
              style={{ color: isValid ? theme.success : theme.error }}
            >
              {isValid ? '✓' : '✗'}
            </span>
            <div>
              <div
                className="text-sm font-medium"
                style={{ color: isValid ? theme.success : theme.error }}
              >
                {isValid ? 'Validation Passed' : 'Validation Failed'}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: theme.text.muted }}>
                {errors.length} error{errors.length !== 1 ? 's' : ''}, {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>

          {/* Navmesh Status */}
          {navmeshStats && (
            <div
              className="p-3 rounded-lg"
              style={{
                backgroundColor: navmeshStats.navmeshGenerated ? `${theme.success}10` : `${theme.warning}10`,
                border: `1px solid ${navmeshStats.navmeshGenerated ? theme.success : theme.warning}20`,
              }}
            >
              <div className="flex items-center gap-2 text-xs" style={{ color: theme.text.primary }}>
                <span>{navmeshStats.navmeshGenerated ? '🗺️' : '⚠️'}</span>
                <span className="font-medium">
                  {navmeshStats.navmeshGenerated ? 'Navmesh Generated' : 'Navmesh Failed'}
                </span>
              </div>
              {navmeshStats.navmeshGenerated && (
                <div className="mt-2 text-[10px]" style={{ color: theme.text.muted }}>
                  Paths checked: {navmeshStats.pathsChecked} |
                  Found: <span style={{ color: theme.success }}>{navmeshStats.pathsFound}</span> |
                  Blocked: <span style={{ color: navmeshStats.pathsBlocked > 0 ? theme.error : theme.text.muted }}>{navmeshStats.pathsBlocked}</span>
                </div>
              )}
            </div>
          )}

          {/* Statistics */}
          {stats && (
            <Section title="Path Statistics" icon="📊" theme={theme} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Bases', value: stats.totalNodes },
                  { label: 'Paths Tested', value: stats.totalEdges },
                  { label: 'Connected', value: stats.connectedPairs, success: true },
                  { label: 'Blocked', value: stats.blockedPairs, error: stats.blockedPairs > 0 },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="px-3 py-2 rounded-lg"
                    style={{ backgroundColor: theme.surface }}
                  >
                    <div className="text-[10px]" style={{ color: theme.text.muted }}>
                      {stat.label}
                    </div>
                    <div
                      className="text-lg font-semibold"
                      style={{
                        color: stat.error
                          ? theme.error
                          : stat.success
                          ? theme.success
                          : theme.text.primary,
                      }}
                    >
                      {stat.value}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <Section title="Errors" icon="❌" theme={theme} badge={errors.length}>
              <div className="space-y-2">
                {errors.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg"
                    style={{
                      backgroundColor: `${theme.error}10`,
                      border: `1px solid ${theme.error}20`,
                    }}
                  >
                    <div className="text-xs" style={{ color: theme.text.primary }}>
                      {issue.message}
                    </div>
                    {issue.affectedNodes && issue.affectedNodes.length > 0 && (
                      <div className="mt-1 text-[10px]" style={{ color: theme.text.muted }}>
                        Affected: {issue.affectedNodes.join(', ')}
                      </div>
                    )}
                    {issue.suggestedFix && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: theme.primary }}>
                        <span>💡</span>
                        {issue.suggestedFix.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <Section title="Warnings" icon="⚠️" theme={theme} badge={warnings.length} defaultOpen={false}>
              <div className="space-y-2">
                {warnings.map((issue, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg"
                    style={{
                      backgroundColor: `${theme.warning}10`,
                      border: `1px solid ${theme.warning}20`,
                    }}
                  >
                    <div className="text-xs" style={{ color: theme.text.primary }}>
                      {issue.message}
                    </div>
                    {issue.affectedNodes && issue.affectedNodes.length > 0 && (
                      <div className="mt-1 text-[10px]" style={{ color: theme.text.muted }}>
                        Affected: {issue.affectedNodes.join(', ')}
                      </div>
                    )}
                    {issue.suggestedFix && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: theme.primary }}>
                        <span>💡</span>
                        {issue.suggestedFix.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Success message */}
          {!errors.length && !warnings.length && (
            <div
              className="text-center py-4 text-sm"
              style={{ color: theme.success }}
            >
              All paths verified! Map is ready for play.
            </div>
          )}

          {/* Auto-fix button */}
          {onAutoFix && hasFixes && (
            <button
              onClick={onAutoFix}
              disabled={isValidating}
              className="w-full py-2.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2"
              style={{
                backgroundColor: `${theme.primary}15`,
                border: `1px solid ${theme.primary}40`,
                color: theme.primary,
              }}
            >
              <span>🔧</span>
              Auto-fix Issues
            </button>
          )}
        </div>
      )}

      {/* Help section */}
      <Section title="How It Works" icon="ℹ️" theme={theme} defaultOpen={false}>
        <ul className="space-y-1.5 text-[11px]" style={{ color: theme.text.muted }}>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>Builds navmesh using Recast Navigation (same as game)</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>Includes terrain, ramps, and decoration obstacles</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>Tests actual pathfinding between all bases</span>
          </li>
          <li className="flex items-start gap-2">
            <span style={{ color: theme.success }}>✓</span>
            <span>If validation passes, game pathfinding will work</span>
          </li>
        </ul>
        <div
          className="mt-3 p-2 rounded text-[10px]"
          style={{ backgroundColor: `${theme.primary}15`, color: theme.primary }}
        >
          💡 This uses the exact same navigation system as the game, ensuring validation accuracy.
        </div>
      </Section>
    </div>
  );
}
