import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV1 } from 'ai'
import type { AppSettings } from '../../shared/schemas.js'

/**
 * Build a language model from settings. The default path is an OpenAI-compatible
 * endpoint (Ollama, LM Studio, vLLM, llama.cpp server) configured via llmBaseUrl.
 *
 * Note: `@ai-sdk/anthropic` is not bundled in v1; selecting 'anthropic' requires
 * adding that package. The three OpenAI-style providers cover the common cases.
 */
export function getModel(settings: AppSettings): LanguageModelV1 {
  switch (settings.llmProvider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: settings.llmApiKey })
      return openai(settings.llmModel)
    }
    case 'anthropic':
      throw new Error(
        "llmProvider 'anthropic' requires the @ai-sdk/anthropic package. Use 'openai-compatible' or add it.",
      )
    case 'ollama':
    case 'openai-compatible':
    default: {
      const provider = createOpenAI({
        baseURL: settings.llmBaseUrl,
        // Local servers often need a non-empty key even if unused.
        apiKey: settings.llmApiKey || 'not-needed',
        compatibility: 'compatible',
      })
      return provider(settings.llmModel)
    }
  }
}
