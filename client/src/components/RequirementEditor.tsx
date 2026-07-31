import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { 
  MessageSquare, 
  Send, 
  Code2, 
  Eye, 
  Save, 
  CheckCircle2, 
  Loader2,
  Paperclip,
  Share2,
  FileText,
  Image as ImageIcon,
  MoreVertical,
  History,
  Cloud,
  Cpu,
  Plus
} from 'lucide-react';
import { getRequirementResponse } from '../services/gemini';
import { ChatMessage, Comment, Asset } from '../types';

export function RequirementEditor() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '您好！我是您的 AI 设计助手。请描述您想要构建的需求或 UI，我将为您生成原型。', timestamp: new Date().toISOString() }
  ]);
  const [comments, setComments] = useState<Comment[]>([
    { id: 'c1', userId: 'u2', content: '我们需要确保移动端的适配性。', timestamp: '2024-03-25T10:00:00Z', attachments: [] }
  ]);
  const [assets, setAssets] = useState<Asset[]>([
    { id: 'a1', name: '设计规范.pdf', type: 'PDF', path: '/docs/spec.pdf', creatorId: 'u1', timestamp: '2024-03-24T15:30:00Z' },
    { id: 'a2', name: '首屏原型图.png', type: 'PNG', path: '/assets/hero.png', creatorId: 'agent-1', timestamp: '2024-03-25T09:12:00Z' }
  ]);
  
  const [input, setInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'comments' | 'assets'>('chat');
  const [activeView, setActiveView] = useState<'preview' | 'code'>('preview');
  const [code, setCode] = useState<string | null>(null);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await getRequirementResponse(input, messages);
      
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response || "生成响应时出错",
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Extract code if present
      const codeMatch = response?.match(/```tsx\n([\s\S]*?)```/);
      if (codeMatch) {
        setCode(codeMatch[1]);
        setActiveView('code');
        
        // Auto-upload as asset (simulating sync)
        const newAsset: Asset = {
          id: `a-${Date.now()}`,
          name: `UI_Component_${Date.now()}.tsx`,
          type: 'TSX',
          path: '#',
          creatorId: 'agent',
          timestamp: new Date().toISOString()
        };
        setAssets(prev => [newAsset, ...prev]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddComment = () => {
    if (!commentInput.trim()) return;
    const newComment: Comment = {
      id: `c-${Date.now()}`,
      userId: 'u1',
      content: commentInput,
      timestamp: new Date().toISOString(),
      attachments: []
    };
    setComments(prev => [...prev, newComment]);
    setCommentInput("");
  };

  const Bot = ({ className }: { className?: string }) => <Cpu className={className} />;

  return (
    <div className="flex bg-muted/30 rounded-2xl border shadow-inner overflow-hidden h-[750px]">
      {/* Left Panel: Collaboration & Intelligence */}
      <div className="w-[450px] border-r flex flex-col bg-card">
        <div className="p-4 border-b flex items-center justify-between">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="chat" className="text-xs">
                <Bot className="w-3.5 h-3.5 mr-2" /> AI 助手
              </TabsTrigger>
              <TabsTrigger value="comments" className="text-xs">
                <MessageSquare className="w-3.5 h-3.5 mr-2" /> 协作区
              </TabsTrigger>
              <TabsTrigger value="assets" className="text-xs">
                <Cloud className="w-3.5 h-3.5 mr-2" /> 资产
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' && (
            <div className="flex flex-col h-full">
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-3 rounded-2xl ${
                        msg.role === 'user' 
                          ? 'bg-primary text-primary-foreground rounded-tr-none' 
                          : 'bg-muted border rounded-tl-none'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className="text-[10px] opacity-50 mt-1">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-muted border p-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground animate-pulse">正在利用 Codex 引擎设计原型...</span>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input 
                    placeholder="描述您的 UI 需求..." 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    disabled={isLoading}
                    className="flex-1"
                  />
                  <Button size="icon" onClick={handleSend} disabled={isLoading}>
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="flex flex-col h-full">
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-6">
                  {comments.map(comment => (
                    <div key={comment.id} className="flex gap-3">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                        {comment.userId.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold">User #{comment.userId}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(comment.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="p-3 rounded-xl bg-muted/40 border text-sm">
                          {comment.content}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" className="shrink-0 h-9 w-9">
                    <Paperclip className="w-4 h-4" />
                  </Button>
                  <Input 
                    placeholder="在评论区共享观点或附件..." 
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                  />
                  <Button onClick={handleAddComment}>评论</Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'assets' && (
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1 mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">需求关联资产</h4>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]"><Plus className="w-3 h-3 mr-1" /> 上传</Button>
                </div>
                {assets.map(asset => (
                  <div key={asset.id} className="p-3 rounded-xl border bg-card hover:bg-muted/30 transition-colors flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/5 flex items-center justify-center text-primary border">
                        {asset.type === 'TSX' ? <Code2 className="w-5 h-5" /> : asset.type === 'PNG' ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate max-w-[200px]">{asset.name}</p>
                        <p className="text-[10px] text-muted-foreground">{asset.type} • {asset.creatorId}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 h-8 w-8">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Right Panel: Delivery & Preview */}
      <div className="flex-1 flex flex-col bg-background">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)} className="w-auto">
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="preview" className="text-xs gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> 预览
                </TabsTrigger>
                <TabsTrigger value="code" className="text-xs gap-1.5">
                  <Code2 className="w-3.5 h-3.5" /> 代码
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="h-4 w-[1px] bg-border" />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <History className="w-3.5 h-3.5" />
              <span>最后更新: 刚刚</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Save className="w-3.5 h-3.5" /> 保存
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> 交付发布
            </Button>
          </div>
        </div>

        <div className="flex-1 relative">
          {activeView === 'preview' ? (
            <div className="absolute inset-0 p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Share2 className="w-10 h-10 text-muted-foreground opacity-20" />
                </div>
                <h3 className="text-lg font-bold mb-2">原型成果预览</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  AI 生成的交互原型已同步至资产空间。所有成员可在评论区分享反馈。
                </p>
                <div className="mt-8 grid grid-cols-2 gap-4 max-w-md mx-auto">
                  <div className="p-4 rounded-xl border bg-muted/20 text-left">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">同步状态</p>
                    <p className="text-xs font-medium text-green-600 flex items-center gap-1">
                      <Cloud className="w-3 h-3" /> 已同步至云端
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border bg-muted/20 text-left">
                    <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">共享角色</p>
                    <p className="text-xs font-medium text-foreground">产品, 研发, 测试</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <ScrollArea className="absolute inset-0">
              <div className="p-6 font-mono text-sm bg-zinc-950 text-zinc-300 min-h-full">
                {code ? (
                  <pre className="whitespace-pre-wrap">{code}</pre>
                ) : (
                  <div className="h-full flex items-center justify-center py-20 text-zinc-600 italic">
                    尚未生成代码。在左侧描述需求，AI 将实时编写代码。
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
