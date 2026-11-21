import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronDownIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '$lib/components/ui/alert-dialog'
import { Badge } from '$lib/components/ui/badge'
import { Button, buttonVariants } from '$lib/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '$lib/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '$lib/components/ui/collapsible'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '$lib/components/ui/command'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '$lib/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import { Input } from '$lib/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '$lib/components/ui/input-group'
import { Kbd, KbdGroup } from '$lib/components/ui/kbd'
import { Label } from '$lib/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '$lib/components/ui/popover'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '$lib/components/ui/resizable'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
import { Separator } from '$lib/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '$lib/components/ui/sheet'
import { Skeleton } from '$lib/components/ui/skeleton'
import { Toaster } from '$lib/components/ui/sonner'
import { Switch } from '$lib/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs'
import { Textarea } from '$lib/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip'
import tokens from '$lib/theme/tokens.json'

const variants = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const
const sizes = ['xs', 'sm', 'default', 'lg'] as const
const badgeVariants = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const
const colorNames = Object.keys(tokens.colors.light)
const models = [
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'sonnet', label: 'Sonnet 5.5' },
  { value: 'haiku', label: 'Haiku 5.5' },
]
const sections = [
  ['couleurs', 'Couleurs'],
  ['typographie', 'Typographie'],
  ['boutons', 'Boutons'],
  ['badges', 'Badges'],
  ['champs', 'Champs'],
  ['cartes', 'Cartes'],
  ['onglets', 'Onglets'],
  ['superpositions', 'Superpositions'],
  ['structure', 'Structure'],
] as const

export function Showcase() {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [model, setModel] = useState('opus')
  const [notify, setNotify] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const [showStats, setShowStats] = useState(true)
  const [showPaths, setShowPaths] = useState(false)

  const modelLabel = models.find((m) => m.value === model)?.label ?? 'Modèle'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <>
      <Toaster theme={dark ? 'dark' : 'light'} richColors />

      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground">
          <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
              <h1 className="text-base font-semibold">Bricks · Composants</h1>
              <nav className="hidden flex-1 gap-1 overflow-x-auto md:flex">
                {sections.map(([id, label]) => (
                  <a
                    key={id}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                    href={`#${id}`}
                  >
                    {label}
                  </a>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-2">
                <Label htmlFor="dark">Sombre</Label>
                <Switch id="dark" checked={dark} onCheckedChange={setDark} />
              </div>
            </div>
          </header>

          <main className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-8">
            <section id="couleurs" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Couleurs</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {colorNames.map((name) => (
                  <div key={name} className="flex flex-col gap-1.5">
                    <div
                      className="h-12 rounded-md border"
                      style={{ backgroundColor: `var(--${name})` }}
                    />
                    <code className="text-caption text-muted-foreground">--{name}</code>
                  </div>
                ))}
              </div>
            </section>

            <section id="typographie" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Typographie</h2>
              <div className="grid gap-3 rounded-lg border p-4">
                <div className="flex items-baseline gap-4">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    text-ui · 13px
                  </span>
                  <span className="text-ui">Le moteur décide chaque appel d&apos;outil.</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    text-compact · 12.5px
                  </span>
                  <span className="text-compact">Le moteur décide chaque appel d&apos;outil.</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    text-caption · 11px
                  </span>
                  <span className="text-caption">Le moteur décide chaque appel d&apos;outil.</span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    text-code · 13px
                  </span>
                  <code className="text-code font-mono">cargo test -p bricks-agent</code>
                </div>
                <Separator />
                <div className="flex flex-wrap items-baseline gap-6">
                  <span className="text-2xl font-semibold">Titre 2xl</span>
                  <span className="text-xl font-semibold">Titre xl</span>
                  <span className="text-lg font-medium">Titre lg</span>
                  <span className="text-sm">Texte sm</span>
                  <span className="text-sm text-muted-foreground">Texte secondaire</span>
                </div>
              </div>
            </section>

            <section id="boutons" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Boutons</h2>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Variante</th>
                      {sizes.map((size) => (
                        <th key={size} className="px-4 py-2 font-medium">
                          {size}
                        </th>
                      ))}
                      <th className="px-4 py-2 font-medium">Désactivé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((variant) => (
                      <tr key={variant} className="border-b last:border-0">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{variant}</td>
                        {sizes.map((size) => (
                          <td key={size} className="px-4 py-3">
                            <Button variant={variant} size={size}>
                              Envoyer
                            </Button>
                          </td>
                        ))}
                        <td className="px-4 py-3">
                          <Button variant={variant} disabled>
                            Envoyer
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="icon-xs" variant="outline" aria-label="Ajouter">
                  <PlusIcon />
                </Button>
                <Button size="icon-sm" variant="outline" aria-label="Ajouter">
                  <PlusIcon />
                </Button>
                <Button size="icon" variant="outline" aria-label="Ajouter">
                  <PlusIcon />
                </Button>
                <Button size="icon-lg" variant="outline" aria-label="Ajouter">
                  <PlusIcon />
                </Button>
                <Separator orientation="vertical" className="mx-2 h-6" />
                <Button>
                  <SendIcon data-icon="inline-start" />
                  Envoyer
                </Button>
                <Button variant="destructive">
                  <Trash2Icon data-icon="inline-start" />
                  Supprimer
                </Button>
                <Button variant="secondary">
                  Options
                  <ChevronDownIcon data-icon="inline-end" />
                </Button>
              </div>
            </section>

            <section id="badges" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Badges</h2>
              <div className="flex flex-wrap items-center gap-2">
                {badgeVariants.map((variant) => (
                  <Badge key={variant} variant={variant}>
                    {variant}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-success-soft text-success">Terminé</Badge>
                <Badge className="bg-warning-soft text-warning">En attente</Badge>
                <Badge className="bg-info-soft text-info">En cours</Badge>
                <Badge variant="destructive">Échec</Badge>
              </div>
            </section>

            <section id="champs" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Champs</h2>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Nom de la session</Label>
                  <Input id="name" placeholder="Refonte des permissions" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invalid">Champ invalide</Label>
                  <Input id="invalid" aria-invalid="true" defaultValue="~autre/bin" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="search">Recherche</Label>
                  <InputGroup>
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput id="search" placeholder="Rechercher un fichier" />
                    <InputGroupAddon align="inline-end">
                      <KbdGroup>
                        <Kbd>⌘</Kbd>
                        <Kbd>K</Kbd>
                      </KbdGroup>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Modèle</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-full">{modelLabel}</SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                  <Label htmlFor="prompt">Message</Label>
                  <Textarea id="prompt" placeholder="Décris la tâche" rows={3} />
                </div>
                <div className="flex items-center gap-3">
                  <Switch id="notify" checked={notify} onCheckedChange={setNotify} />
                  <Label htmlFor="notify">Notifications</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Input disabled placeholder="Désactivé" />
                </div>
              </div>
            </section>

            <section id="cartes" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Cartes</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Permissions</CardTitle>
                    <CardDescription>Profil de la session</CardDescription>
                    <CardAction>
                      <Badge variant="outline">ASK</Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="text-sm">
                    Lecture et recherche libres, le reste demandé.
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button size="sm" variant="outline">
                      Modifier
                    </Button>
                    <Button size="sm">Appliquer</Button>
                  </CardFooter>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Contexte</CardTitle>
                    <CardDescription>Jetons utilisés</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <div className="text-2xl font-semibold tabular-nums">48 200</div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-[38%] bg-primary" />
                    </div>
                    <div className="text-xs text-muted-foreground">38 % de 128 000</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Chargement</CardTitle>
                    <CardDescription>Skeleton</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-full" />
                      <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              </div>
            </section>

            <section id="onglets" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Onglets</h2>
              <Tabs defaultValue="general" className="max-w-xl">
                <TabsList>
                  <TabsTrigger value="general">Général</TabsTrigger>
                  <TabsTrigger value="models">Modèles</TabsTrigger>
                  <TabsTrigger value="tools">Outils</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="rounded-lg border p-4 text-sm">
                  Paramètres généraux.
                </TabsContent>
                <TabsContent value="models" className="rounded-lg border p-4 text-sm">
                  Fournisseurs et modèles.
                </TabsContent>
                <TabsContent value="tools" className="rounded-lg border p-4 text-sm">
                  Outils et serveurs MCP.
                </TabsContent>
              </Tabs>
            </section>

            <section id="superpositions" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Superpositions</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Dialog>
                  <DialogTrigger className={buttonVariants({ variant: 'outline' })}>
                    Dialog
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Renommer la session</DialogTitle>
                      <DialogDescription>
                        Le nom apparaît dans la barre latérale.
                      </DialogDescription>
                    </DialogHeader>
                    <Input defaultValue="Refonte des permissions" />
                    <DialogFooter>
                      <DialogClose className={buttonVariants({ variant: 'outline' })}>
                        Annuler
                      </DialogClose>
                      <DialogClose className={buttonVariants()}>Renommer</DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <AlertDialog>
                  <AlertDialogTrigger className={buttonVariants({ variant: 'destructive' })}>
                    Alert dialog
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Supprimer la session ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Cette action est définitive.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction>Supprimer</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Sheet>
                  <SheetTrigger className={buttonVariants({ variant: 'outline' })}>
                    Sheet
                  </SheetTrigger>
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Détails du job</SheetTitle>
                      <SheetDescription>bg-3 · npm run dev</SheetDescription>
                    </SheetHeader>
                    <div className="flex flex-col gap-2 px-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">État</span>
                        <Badge className="bg-info-soft text-info">En cours</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Durée</span>
                        <span className="tabular-nums">2 min 14 s</span>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>

                <Popover>
                  <PopoverTrigger className={buttonVariants({ variant: 'outline' })}>
                    Popover
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <PopoverHeader>
                      <PopoverTitle>Raisonnement</PopoverTitle>
                      <PopoverDescription>Effort du modèle</PopoverDescription>
                    </PopoverHeader>
                    <div className="flex gap-1">
                      <Button size="xs" variant="outline">
                        low
                      </Button>
                      <Button size="xs">high</Button>
                      <Button size="xs" variant="outline">
                        max
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Tooltip>
                  <TooltipTrigger
                    className={buttonVariants({ variant: 'outline', size: 'icon' })}
                    aria-label="Paramètres"
                  >
                    <SettingsIcon />
                  </TooltipTrigger>
                  <TooltipContent>Paramètres</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger className={buttonVariants({ variant: 'outline' })}>
                    Menu
                    <ChevronDownIcon data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    <DropdownMenuLabel>Session</DropdownMenuLabel>
                    <DropdownMenuItem>
                      Renommer<DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>Dupliquer</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem checked={showStats} onCheckedChange={setShowStats}>
                      Statistiques
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={showPaths} onCheckedChange={setShowPaths}>
                      Chemins complets
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">Supprimer</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="outline" onClick={() => setCommandOpen(true)}>
                  Command
                  <KbdGroup className="ml-1">
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                  </KbdGroup>
                </Button>

                <Button variant="outline" onClick={() => toast.success('Session enregistrée')}>
                  Toast
                </Button>
                <Button variant="outline" onClick={() => toast.error('Connexion perdue')}>
                  Toast erreur
                </Button>
              </div>

              <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
                <CommandInput placeholder="Commande ou fichier" />
                <CommandList>
                  <CommandEmpty>Aucun résultat</CommandEmpty>
                  <CommandGroup heading="Commandes">
                    <CommandItem>
                      Nouvelle session<CommandShortcut>⌘N</CommandShortcut>
                    </CommandItem>
                    <CommandItem>Changer de modèle</CommandItem>
                    <CommandItem>
                      Paramètres<CommandShortcut>⌘,</CommandShortcut>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup heading="Fichiers">
                    <CommandItem>crates/bricks-tools/src/shell/mod.rs</CommandItem>
                    <CommandItem>crates/bricks-agent/src/request_env.rs</CommandItem>
                  </CommandGroup>
                </CommandList>
              </CommandDialog>
            </section>

            <section id="structure" className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Structure</h2>
              <div className="grid gap-6 md:grid-cols-2">
                <Collapsible defaultOpen className="rounded-lg border">
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm font-medium hover:bg-muted">
                    Étapes du run
                    <ChevronDownIcon className="size-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="flex flex-col gap-2 px-4 pb-3 text-sm">
                    <div className="flex justify-between">
                      <span>Read · shell/mod.rs</span>
                      <span className="text-muted-foreground tabular-nums">12 ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Edit · state.rs</span>
                      <span className="text-muted-foreground tabular-nums">8 ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Bash · cargo nextest</span>
                      <span className="text-muted-foreground tabular-nums">41 s</span>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <ScrollArea className="h-40 rounded-lg border">
                  <div className="flex flex-col p-2 text-sm">
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <div key={n} className="rounded-md px-2 py-1.5 hover:bg-muted">
                        Session {n}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="h-48 overflow-hidden rounded-lg border md:col-span-2">
                  <ResizablePanelGroup orientation="horizontal">
                    <ResizablePanel
                      defaultSize="30%"
                      className="bg-sidebar p-3 text-sm text-sidebar-foreground"
                    >
                      Barre latérale
                    </ResizablePanel>
                    <ResizableHandle withHandle />
                    <ResizablePanel defaultSize="70%" className="p-3 text-sm">
                      Conversation
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>
              </div>
            </section>
          </main>
        </div>
      </TooltipProvider>
    </>
  )
}

export default Showcase
