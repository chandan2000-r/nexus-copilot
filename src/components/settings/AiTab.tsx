import { useState } from 'react'
import { STYLE_LABELS } from '../../services/copilot/prompts'
import type { ProviderTestResult, SecretsStatus } from '../../shared/ipc'
import { ANSWER_SPEEDS, LLM_PROVIDERS } from '../../shared/providers'
import type { AnswerSpeed, AnswerStyle, LlmProviderId, Settings, SettingsPatch } from '../../shared/settings'
import { KeyField, ModelField, Row, TextField, Toggle } from './fields'

interface Props {
  settings: Settings
  secrets: SecretsStatus | null
  onSecrets(s: SecretsStatus): void
  update(p: SettingsPatch): Promise<unknown>
}

export function AiTab({ settings, secrets, onSecrets, update }: Props) {
  const id = settings.ai.provider
  const meta = LLM_PROVIDERS[id]
  const [test, setTest] = useState<ProviderTestResult | 'running' | null>(null)

  return (
    <>
      <h2>Answer model</h2>
      <Row label="Provider">
        <select
          value={id}
          onChange={(e) => {
            setTest(null)
            void update({ ai: { provider: e.target.value as LlmProviderId } })
          }}
        >
          {(Object.keys(LLM_PROVIDERS) as LlmProviderId[]).map((p) => (
            <option key={p} value={p}>
              {LLM_PROVIDERS[p].name}
            </option>
          ))}
        </select>
      </Row>
      <p className="section-hint">{meta.hint}</p>

      {id === 'openai' && (
        <div className="field-block">
          <div className="field-label">Base URL</div>
          <TextField mono value={settings.ai.openaiBaseUrl} onCommit={(v) => update({ ai: { openaiBaseUrl: v } })} ariaLabel="Base URL" />
        </div>
      )}
      {id === 'ollama' && (
        <div className="field-block">
          <div className="field-label">Ollama URL</div>
          <TextField mono value={settings.ai.ollamaBaseUrl} onCommit={(v) => update({ ai: { ollamaBaseUrl: v } })} ariaLabel="Ollama URL" />
        </div>
      )}
      {meta.keyName && (
        <KeyField
          name={meta.keyName}
          label={`${meta.name} API key${meta.keyOptional ? ' (optional for local servers)' : ''}`}
          status={secrets}
          onStatus={onSecrets}
          hint={meta.keyUrl ? <>Get one at {meta.keyUrl}</> : undefined}
        />
      )}
      <ModelField
        id={id}
        value={settings.ai.models[id]}
        suggestions={meta.suggestedModels}
        onCommit={(v) => update({ ai: { models: { [id]: v } } })}
        load={() => window.nexus.ai.models(id)}
      />
      {(id === 'openai' || id === 'gemini' || id === 'ollama') && (
        <Row
          label="Answer speed"
          hint="How long thinking models (GPT-5 / o-series, Gemini, and local Qwen3 / DeepSeek-R1 / gpt-oss) think before answering. Fastest suits live questions; Thorough helps on hard coding problems."
        >
          <select value={settings.ai.speed} onChange={(e) => update({ ai: { speed: e.target.value as AnswerSpeed } })}>
            {(Object.keys(ANSWER_SPEEDS) as AnswerSpeed[]).map((s) => (
              <option key={s} value={s}>
                {ANSWER_SPEEDS[s]}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="Max answer length" hint="Tokens. Reasoning models need more headroom.">
        <select value={settings.ai.maxTokens} onChange={(e) => update({ ai: { maxTokens: Number(e.target.value) } })}>
          {[1024, 2048, 4096, 8192, 16000].map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()}
            </option>
          ))}
        </select>
      </Row>
      <div className="test-row">
        <button
          className="mini-btn primary"
          disabled={test === 'running'}
          onClick={async () => {
            setTest('running')
            setTest(await window.nexus.ai.test(id))
          }}
        >
          {test === 'running' ? 'Testing…' : 'Test connection'}
        </button>
        {test && test !== 'running' && (
          <span className={test.ok ? 'test-ok' : 'test-bad'}>
            {test.ok ? `Works — replied "${test.reply}" in ${(test.ms / 1000).toFixed(1)} s` : test.error}
          </span>
        )}
      </div>

      <h2>Answers</h2>
      <Toggle
        label="Auto-answer questions"
        hint="Answer as soon as the other side finishes a question. Otherwise use the ⚡ button or shortcut."
        checked={settings.copilot.autoAnswer}
        onChange={(v) => update({ copilot: { autoAnswer: v } })}
      />
      <Row label="Answer style">
        <select value={settings.copilot.answerStyle} onChange={(e) => update({ copilot: { answerStyle: e.target.value as AnswerStyle } })}>
          {(Object.keys(STYLE_LABELS) as AnswerStyle[]).map((s) => (
            <option key={s} value={s}>
              {STYLE_LABELS[s]}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Answer language" hint="Empty = the language of the question.">
        <TextField
          value={settings.copilot.responseLanguage}
          placeholder="Same as question"
          onCommit={(v) => update({ copilot: { responseLanguage: v.trim() } })}
          ariaLabel="Answer language"
        />
      </Row>
      <Toggle
        label="Save sessions"
        hint="Keep transcripts and answers on this computer (History)."
        checked={settings.copilot.saveSessions}
        onChange={(v) => update({ copilot: { saveSessions: v } })}
      />
    </>
  )
}
