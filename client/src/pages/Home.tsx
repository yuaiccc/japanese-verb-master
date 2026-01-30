import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Search, BookOpen, Table2, Sparkles, ChevronRight } from "lucide-react";

type VerbType = "GODAN" | "ICHIDAN" | "SURU" | "KURU";

export default function Home() {
  const [verbInput, setVerbInput] = useState("");
  const [queryVerb, setQueryVerb] = useState("");

  const { data: verbTypes } = trpc.verb.getTypes.useQuery();
  const { data: exampleVerbs } = trpc.verb.getExamples.useQuery();
  const { data: conjugationResult, isLoading, error } = trpc.verb.conjugate.useQuery(
    { verb: queryVerb },
    { enabled: !!queryVerb }
  );

  const handleSearch = () => {
    if (verbInput) {
      setQueryVerb(verbInput);
    }
  };

  const handleExampleClick = (verb: string) => {
    setVerbInput(verb);
    setQueryVerb(verb);
  };

  // 活用形式名称映射
  const conjugationLabels = useMemo(() => ({
    negative: { name: "否定式", nameJa: "ない形", description: "表示否定" },
    polite: { name: "礼貌式", nameJa: "ます形", description: "礼貌表达" },
    teForm: { name: "て形", nameJa: "て形", description: "连接、请求" },
    taForm: { name: "过去式", nameJa: "た形", description: "过去时态" },
    potential: { name: "可能形", nameJa: "可能形", description: "表示能力" },
    passive: { name: "被动形", nameJa: "受身形", description: "被动语态" },
    causative: { name: "使役形", nameJa: "使役形", description: "使役表达" },
    imperative: { name: "命令形", nameJa: "命令形", description: "命令语气" },
    volitional: { name: "意向形", nameJa: "意向形", description: "意图推测" },
  }), []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🇯🇵</span>
            <h1 className="text-xl font-bold">Japanese Verb Master</h1>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#tool" className="text-muted-foreground hover:text-foreground transition-colors">查询工具</a>
            <a href="#guide" className="text-muted-foreground hover:text-foreground transition-colors">分类指南</a>
            <a href="#table" className="text-muted-foreground hover:text-foreground transition-colors">对照表</a>
            <a href="#examples" className="text-muted-foreground hover:text-foreground transition-colors">示例动词</a>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8 md:py-12">
        <Tabs defaultValue="tool" className="space-y-8">
          <TabsList className="grid w-full max-w-2xl mx-auto grid-cols-4">
            <TabsTrigger value="tool" className="gap-2">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">查询</span>
            </TabsTrigger>
            <TabsTrigger value="guide" className="gap-2">
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">指南</span>
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-2">
              <Table2 className="h-4 w-4" />
              <span className="hidden sm:inline">对照表</span>
            </TabsTrigger>
            <TabsTrigger value="examples" className="gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">示例</span>
            </TabsTrigger>
          </TabsList>

          {/* Tool Tab */}
          <TabsContent value="tool" id="tool">
            <div className="grid lg:grid-cols-2 gap-8">
              {/* Input Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-primary" />
                    动词活用查询
                  </CardTitle>
                  <CardDescription>
                    输入动词原形，系统自动识别类型并显示所有活用形式
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="verb">动词原形</Label>
                    <Input
                      id="verb"
                      placeholder="例如：飲む、食べる、勉強する、来る"
                      value={verbInput}
                      onChange={(e) => setVerbInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="text-lg"
                    />
                  </div>
                  <Button 
                    onClick={handleSearch} 
                    className="w-full" 
                    size="lg"
                    disabled={!verbInput}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    查询活用
                  </Button>

                  {/* Quick Examples */}
                  <div className="pt-4">
                    <p className="text-sm text-muted-foreground mb-3">快速示例：</p>
                    <div className="flex flex-wrap gap-2">
                      {exampleVerbs?.slice(0, 8).map((ex) => (
                        <Button
                          key={ex.verb}
                          variant="outline"
                          size="sm"
                          onClick={() => handleExampleClick(ex.verb)}
                        >
                          {ex.verb}
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Result Card */}
              <Card>
                <CardHeader>
                  <CardTitle>活用结果</CardTitle>
                  <CardDescription>
                    {conjugationResult 
                      ? `${conjugationResult.dictionaryForm} 的所有活用形式`
                      : "输入动词后显示结果"
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading && (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  )}
                  {error && (
                    <div className="text-center py-12 text-destructive">
                      查询失败，请检查输入
                    </div>
                  )}
                  {!conjugationResult && !isLoading && !error && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
                      <p>请输入动词原形</p>
                      <p className="text-sm mt-2">系统将自动识别动词类型</p>
                    </div>
                  )}
                  {conjugationResult && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-2xl font-bold">{conjugationResult.dictionaryForm}</span>
                        <Badge variant="secondary">
                          {verbTypes?.find(t => t.id === conjugationResult.verbType)?.name}
                        </Badge>
                      </div>
                      <div className="grid gap-2">
                        {Object.entries(conjugationLabels).map(([key, label]) => (
                          <div 
                            key={key} 
                            className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-muted-foreground w-16">{label.name}</span>
                              <span className="text-xs text-muted-foreground">({label.nameJa})</span>
                            </div>
                            <span className="text-lg font-medium">
                              {conjugationResult[key as keyof typeof conjugationResult]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Guide Tab */}
          <TabsContent value="guide" id="guide">
            <div className="max-w-4xl mx-auto mb-6">
              <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground">
                    日语动词分为四种类型，系统会根据词尾自动识别。了解这些规则有助于更好地理解日语动词变化。
                  </p>
                </CardContent>
              </Card>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              {verbTypes?.map((type) => (
                <Card key={type.id} className="overflow-hidden">
                  <CardHeader className="bg-muted/50">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{type.name}</CardTitle>
                      <Badge variant="outline">{type.nameJa}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    <p className="text-muted-foreground">{type.description}</p>
                    <div>
                      <p className="text-sm font-medium mb-2">词尾特征：</p>
                      <div className="flex flex-wrap gap-2">
                        {type.endings.map((ending) => (
                          <Badge key={ending} variant="secondary">{ending}</Badge>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-sm font-medium mb-2">常见例词：</p>
                      <div className="flex flex-wrap gap-2">
                        {type.examples.map((ex) => (
                          <Button
                            key={ex}
                            variant="ghost"
                            size="sm"
                            className="h-auto py-1"
                            onClick={() => handleExampleClick(ex)}
                          >
                            {ex}
                            <ChevronRight className="h-3 w-3 ml-1" />
                          </Button>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Table Tab */}
          <TabsContent value="table" id="table">
            <Card>
              <CardHeader>
                <CardTitle>活用形式对照表</CardTitle>
                <CardDescription>
                  所有活用形式的详细说明和用法
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-4 font-medium">活用形式</th>
                        <th className="text-left p-4 font-medium">日语名称</th>
                        <th className="text-left p-4 font-medium">用途说明</th>
                        <th className="text-left p-4 font-medium">五段例 (飲む)</th>
                        <th className="text-left p-4 font-medium">一段例 (食べる)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">原形</td>
                        <td className="p-4 text-muted-foreground">辞書形</td>
                        <td className="p-4">字典形式，基本形</td>
                        <td className="p-4">飲む</td>
                        <td className="p-4">食べる</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">否定式</td>
                        <td className="p-4 text-muted-foreground">ない形</td>
                        <td className="p-4">表示否定含义</td>
                        <td className="p-4">飲まない</td>
                        <td className="p-4">食べない</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">礼貌式</td>
                        <td className="p-4 text-muted-foreground">ます形</td>
                        <td className="p-4">正式、礼貌的表达</td>
                        <td className="p-4">飲みます</td>
                        <td className="p-4">食べます</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">て形</td>
                        <td className="p-4 text-muted-foreground">て形</td>
                        <td className="p-4">连接动作、请求</td>
                        <td className="p-4">飲んで</td>
                        <td className="p-4">食べて</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">过去式</td>
                        <td className="p-4 text-muted-foreground">た形</td>
                        <td className="p-4">表示过去的动作</td>
                        <td className="p-4">飲んだ</td>
                        <td className="p-4">食べた</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">可能形</td>
                        <td className="p-4 text-muted-foreground">可能形</td>
                        <td className="p-4">表示能力或可能性</td>
                        <td className="p-4">飲める</td>
                        <td className="p-4">食べられる</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">被动形</td>
                        <td className="p-4 text-muted-foreground">受身形</td>
                        <td className="p-4">表示被动语态</td>
                        <td className="p-4">飲まれる</td>
                        <td className="p-4">食べられる</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">使役形</td>
                        <td className="p-4 text-muted-foreground">使役形</td>
                        <td className="p-4">表示使役关系</td>
                        <td className="p-4">飲ませる</td>
                        <td className="p-4">食べさせる</td>
                      </tr>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="p-4 font-medium">命令形</td>
                        <td className="p-4 text-muted-foreground">命令形</td>
                        <td className="p-4">表示命令或指示</td>
                        <td className="p-4">飲め</td>
                        <td className="p-4">食べろ</td>
                      </tr>
                      <tr className="hover:bg-muted/30">
                        <td className="p-4 font-medium">意向形</td>
                        <td className="p-4 text-muted-foreground">意向形</td>
                        <td className="p-4">表示意图或推测</td>
                        <td className="p-4">飲もう</td>
                        <td className="p-4">食べよう</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Examples Tab */}
          <TabsContent value="examples" id="examples">
            <Card>
              <CardHeader>
                <CardTitle>示例动词库</CardTitle>
                <CardDescription>
                  点击任意动词快速查看其活用形式
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {verbTypes?.map((type) => {
                    const typeExamples = exampleVerbs?.filter(ex => ex.type === type.id);
                    if (!typeExamples?.length) return null;
                    return (
                      <div key={type.id}>
                        <h3 className="font-medium mb-3 flex items-center gap-2">
                          <Badge variant="outline">{type.name}</Badge>
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {typeExamples.map((ex) => (
                            <Button
                              key={ex.verb}
                              variant="outline"
                              className="h-auto py-3 flex-col items-start"
                              onClick={() => handleExampleClick(ex.verb)}
                            >
                              <span className="text-lg font-medium">{ex.verb}</span>
                              <span className="text-xs text-muted-foreground">
                                {ex.meaning} ({ex.romaji})
                              </span>
                            </Button>
                          ))}
                        </div>
                        <Separator className="mt-6" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 bg-muted/30">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Japanese Verb Master - 日语动词活用专家</p>
          <p className="mt-2">自动识别动词类型，精准计算所有活用形式</p>
        </div>
      </footer>
    </div>
  );
}
