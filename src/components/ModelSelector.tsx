'use client'

import React from 'react'
import { useApp } from '@/context/AppContext'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Globe, Server, Check, X, Loader2 } from 'lucide-react'

const apiKeyLinks: Array<{
  id: string
  name: string
  url: string
  envKey: string
}> = [
  { id: 'openai', name: 'OpenAI', url: 'https://platform.openai.com/api-keys', envKey: 'OPENAI_API_KEY' },
  { id: 'gemini', name: 'Google Gemini', url: 'https://aistudio.google.com/app/apikey', envKey: 'GEMINI_API_KEY' },
  { id: 'deepseek', name: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys', envKey: 'DEEPSEEK_API_KEY' },
  { id: 'grok', name: 'xAI Grok', url: 'https://console.x.ai', envKey: 'GROK_API_KEY' },
  { id: 'qwen', name: 'Qwen (DashScope)', url: 'https://dashscope.console.aliyun.com/apiKey', envKey: 'QWEN_API_KEY' },
  { id: 'glm', name: 'GLM (Zhipu)', url: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', envKey: 'GLM_API_KEY' },
  { id: 'mistral', name: 'Mistral', url: 'https://console.mistral.ai/api-keys', envKey: 'MISTRAL_API_KEY' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/keys', envKey: 'OPENROUTER_API_KEY' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/settings/tokens', envKey: 'HUGGINGFACE_API_KEY' },
  { id: 'minimax', name: 'MiniMax', url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', envKey: 'MINIMAX_API_KEY' },
]

export default function ModelSelector() {
  const { models, selectedModel, setSelectedModel } = useApp()
  const chatModelLock = 'ollama'

  const apiModels = models.filter(m => m.type === 'api')
  const localModels = models.filter(m => m.type === 'local')

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'available':
        return <Check className="w-3 h-3 text-green-500" />
      case 'unavailable':
        return <X className="w-3 h-3 text-red-500" />
      case 'checking':
        return <Loader2 className="w-3 h-3 text-yellow-500 animate-spin" />
      default:
        return null
    }
  }

  return (
    <>
      <Select value={selectedModel} onValueChange={setSelectedModel}>
        <SelectTrigger className="w-full bg-zinc-800 border-zinc-700 text-white">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent className="bg-zinc-800 border-zinc-700">
          <SelectGroup>
            <SelectLabel className="text-zinc-400 flex items-center gap-2">
              <Globe className="w-3 h-3" />
              API Models
            </SelectLabel>
            {apiModels.map((model) => (
              <SelectItem
                key={model.id}
                value={model.id}
                disabled
                className="text-white hover:bg-zinc-700 focus:bg-zinc-700"
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <span>{model.name}</span>
                  <Badge variant="outline" className="text-[10px] border-zinc-600 text-zinc-500">
                    Reserved
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel className="text-zinc-400 flex items-center gap-2">
              <Server className="w-3 h-3" />
              Local Models
            </SelectLabel>
            {localModels.map((model) => (
              <SelectItem
                key={model.id}
                value={model.id}
                disabled={model.status === 'unavailable' || model.id !== chatModelLock}
                className={`text-white hover:bg-zinc-700 focus:bg-zinc-700 ${
                  model.status === 'unavailable' || model.id !== chatModelLock ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-center justify-between w-full gap-2">
                  <span>{model.name}</span>
                  <div className="flex items-center gap-1">
                    {getStatusIcon(model.status)}
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="mt-2 text-[10px] text-zinc-500">
        Chat model locked to Ollama. Cloud APIs are reserved for voice and emergency fallback.
      </p>
      <details className="mt-3 rounded-md border border-zinc-700 bg-zinc-900 p-2">
        <summary className="cursor-pointer text-xs font-medium text-zinc-300">
          Free Tier API Links (click to open)
        </summary>
        <div className="mt-2 space-y-2">
          {apiKeyLinks.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 px-2 py-1">
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-200">{provider.name}</p>
                <p className="truncate text-[10px] text-zinc-500">{provider.envKey}</p>
              </div>
              <a
                href={provider.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded bg-blue-600 px-2 py-1 text-[10px] text-white hover:bg-blue-700"
              >
                Open
              </a>
            </div>
          ))}
        </div>
      </details>
    </>
  )
}
