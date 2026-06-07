import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModelV1 } from 'ai'
import type { AppSettings } from '../../shared/schemas.js'

/**
 * Build a language model from settings. The default path is an OpenAI-compatible
 * endpoint (Ollama, LM Studio, vLLM, llama.cpp server) configured via llmBaseUrl.
 * 'openai' and 'anthropic' hit the respective cloud APIs with llmApiKey.
 */
export function getModel(settings: AppSettings): LanguageModelV1 {
  switch (settings.llmProvider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: settings.llmApiKey })
      return openai(settings.llmModel)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: settings.llmApiKey })
      return anthropic(settings.llmModel)
    }
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
