import * as React from 'react';
import { Bell, Check, Star } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Callout, MarkdownTable } from '@/components/mdx-components';
import MDXPreview from '@/components/MDXPreview';
import DocumentProperties from '@/components/properties/DocumentProperties';
import { Run } from '@/components/RunButton';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { TypographyH3, TypographyMuted, TypographyP } from '@/components/ui/typography';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold text-[var(--ink-secondary)]">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

const FRUITS = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

const PROPERTY_EXAMPLES = [
  { name: 'No properties (Live)', doc: '# A new note' },
  { name: 'No properties (Reading)', readOnly: true, doc: '# A new note' },
  { name: 'One property', doc: '---\nstatus: Draft\n---\n' },
  { name: 'Every type, long values and empty values', doc: [
    '---', 'title: A note with every property type',
    `description: ${'A long value wraps within the document, leaving its label easy to scan. '.repeat(5)}`,
    'summary: |', '  First line of a multiline value.', '  Second line stays on its own line.',
    'tags: [design, writing, reference, keyboard, accessibility, research, review, documentation, long-tag-without-spaces-that-must-wrap-within-the-value-column]',
    'aliases: [Alternate title, Another name]', 'people: [Ada, Lin]', 'due: 2026-11-18',
    'created: 2026-11-18T09:30:00Z', 'completed: true', 'archived: false', 'rating: 1234.5',
    'url: https://example.com/a/long/path', 'related: "[[Gallery note]]"', 'empty: ""', 'empty_list: []',
    'metadata: {owner: Ada, reviewed: true}', '---', '', '# Note body',
  ].join('\n') },
  { name: 'Reading', readOnly: true, doc: '---\ntitle: A read-only note\ntags: [reference, design]\ndue: 2026-11-18\nempty: ""\n---\n' },
  { name: 'Collapsed', collapsed: true, doc: '---\ntitle: Collapsed note\ntags: [reference]\n---\n' },
  { name: 'Invalid YAML', doc: '---\ntitle: "unterminated\ntags: [a, b\n---\n' },
];

function PropertyExample({ name, doc: initialDoc, readOnly, collapsed }: typeof PROPERTY_EXAMPLES[number]) {
  const [doc, setDoc] = React.useState(initialDoc);
  const [raw, setRaw] = React.useState(false);
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-medium text-[var(--ink-secondary)]">{name}</h3>
      <DocumentProperties doc={doc} onChangeDoc={readOnly ? undefined : setDoc} defaultCollapsed={collapsed} onViewRaw={() => setRaw(true)} />
      {raw && <div className="space-y-2">
        <Textarea aria-label={`YAML for ${name}`} value={doc} onChange={(event) => setDoc(event.target.value)} className="min-h-32 font-mono" />
        <Button variant="secondary" size="sm" onClick={() => setRaw(false)}>Done editing YAML</Button>
      </div>}
      <p className="pt-2 text-sm text-[var(--ink-secondary)]">The note continues here.</p>
    </div>
  );
}

const MDX_EXAMPLES = [
  '---', 'fullWidth: true', '---', '# Rendered MDX', '',
  '## Badges', '',
  ...['success', 'info', 'warning', 'error', 'neutral', 'default', 'plain'].map((type) => `<Badge type="${type}" text="${type}" />`), '',
  '## Layout and tones', '', '<Grid gap="sm">',
  ...['plain', 'surface', 'accent', 'positive', 'danger'].flatMap((tone) => [
    `<Card title="${tone.charAt(0).toUpperCase() + tone.slice(1)} card" tone="${tone}">`,
    'Card content keeps a neutral surface.', '</Card>',
    `<Stat label="${tone.charAt(0).toUpperCase() + tone.slice(1)} metric" value="1,234" tone="${tone}" />`,
  ]), '</Grid>', '',
  '<Card title="Outer card">', '<Row gap="md">', '<Col gap="sm">',
  '<Card title="Nested card" tone="positive">', 'This card is flattened.', '</Card>', '</Col>',
  '<Col gap="sm">', 'A second column wraps with the row.', '</Col>', '</Row>', '</Card>', '',
  '<Grid cols="3" gap="sm">', '<Cell cols="2">', 'A cell spans two columns.', '</Cell>',
  '<Cell cols="1">', 'One column.', '</Cell>', '</Grid>', '',
  '<Divider label="Study and commands" />',
  '<Flashcard front="Where are note properties stored?">', 'In **YAML frontmatter**, inside the note.', '</Flashcard>',
  '<Flashcard front="An empty answer" />', '',
  '<Run label="Print working directory" cmd="pwd" />',
  '<Run label="Accent tone" cmd="pwd" tone="accent" />',
  '<Run />', '',
  '## Reading rhythm', '',
  'Inline `code` and [[Gallery note]] sit alongside a [[Missing note]].', '',
  '> A quote keeps the reading rhythm without a coloured stripe or a card.', '',
  '- [ ] An incomplete task', '- [x] A completed task', '',
  '```typescript', 'const greeting = "Hello, Neuron";', 'console.log(greeting);', '```', '',
  '| Name | Count | Change | Mixed |', '| --- | --- | --- | --- |',
  '| Ada | 12 | -1.5 | 7 |', '| Lin | 1234 | +2.5 | pending |', '',
  '## Diagrams', '', '```mermaid', 'flowchart LR', '  Draft --> Review --> Published', '```', '',
  '## Database embeds', '',
  'These live examples use Planner.db from the demo workspace. Other workspaces show the missing-file state.', '',
  '<DbView path="@Planner.db" table="tasks" view="table" />',
  '<DbView path="@Planner.db" table="tasks" view="board" />',
  '<DbView path="@Planner.db" table="projects" view="gallery" />',
  '<DbView path="@missing-gallery-example.db" />', '',
].join('\n');

export default function ComponentGallery({ colorScheme = 'dark' }: { colorScheme?: 'light' | 'dark' }) {
  const [combo, setCombo] = React.useState('');
  const [date, setDate] = React.useState<Date | undefined>(new Date());
  const [narrow, setNarrow] = React.useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <Toaster />
      <div className="mx-auto w-full max-w-5xl space-y-8 px-7 pb-16 pt-7">
        <header>
          <h1 className="text-base font-semibold text-[var(--ink)]">Component gallery</h1>
          <p className="mt-1 text-sm text-[var(--ink-secondary)]">App controls and rendered notes, themed to the workspace palette.</p>
        </header>

        <section aria-label="Rendered note gallery" className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Document properties and MDX</h2>
            <Toggle pressed={narrow} onPressedChange={setNarrow} aria-label="Use 720px content width">720px content</Toggle>
            <span className="text-xs text-[var(--ink-muted)]">Switch the app theme to review light and dark.</span>
          </div>
          <div className={`mx-auto w-full space-y-8 ${narrow ? 'max-w-[720px]' : ''}`}>
            {PROPERTY_EXAMPLES.map((example) => <PropertyExample key={example.name} {...example} />)}
            <div className="[&>div]:h-auto [&>div]:overflow-visible [&>div]:p-0">
              <MDXPreview mdxContent={MDX_EXAMPLES} colorScheme={colorScheme} showProperties={false} notes={['Gallery note.md']} onWikiLinkClick={() => toast('Gallery link opened')} />
            </div>
            <div>
              <h3 className="text-[13px] font-medium text-[var(--ink-secondary)]">Refused multiline command</h3>
              <Run cmd={'first\nsecond'} />
            </div>
            <div>
              <h3 className="text-[13px] font-medium text-[var(--ink-secondary)]">Standalone MarkdownTable</h3>
              <MarkdownTable headers={['Name', 'Count', 'Mixed']} aligns={['left', 'left', 'left']} rows={[
                ['Ada', '12', '7'], ['Lin', '1234', 'pending'],
              ]} />
            </div>
          </div>
        </section>

        <Section title="Buttons">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button size="sm">Small</Button>
        </Section>

        <Section title="Badges & Kbd">
          <Badge>Badge</Badge>
          <Kbd>⌘K</Kbd>
          <Kbd>Ctrl</Kbd>
        </Section>

        <Section title="Card">
          <Card className="w-72">
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>A short description.</CardDescription>
            </CardHeader>
            <CardContent><TypographyMuted>Body content lives here.</TypographyMuted></CardContent>
            <CardFooter><Button size="sm">Action</Button></CardFooter>
          </Card>
        </Section>

        <Section title="Alert">
          <Alert className="max-w-md">
            <Bell className="size-4" />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>This is a themed alert message.</AlertDescription>
          </Alert>
        </Section>

        <Section title="Callout">
          <div className="max-w-md">
            <Callout type="success" title="Saved">Every change is on disk.</Callout>
            <Callout type="info">Notes are plain files in this folder.</Callout>
            <Callout type="warning" title="Unsaved changes">Closing now loses them.</Callout>
            <Callout type="error" title="Could not save">The file is read-only.</Callout>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="flex items-center gap-2"><Checkbox id="c1" /><Label htmlFor="c1">Accept</Label></div>
          <div className="flex items-center gap-2"><Switch id="s1" /><Label htmlFor="s1">Enabled</Label></div>
          <RadioGroup defaultValue="a" className="flex gap-3">
            <div className="flex items-center gap-1.5"><RadioGroupItem value="a" id="r-a" /><Label htmlFor="r-a">A</Label></div>
            <div className="flex items-center gap-1.5"><RadioGroupItem value="b" id="r-b" /><Label htmlFor="r-b">B</Label></div>
          </RadioGroup>
          <Input className="w-48" placeholder="Input" />
          <Textarea className="w-48" placeholder="Textarea" />
          <NativeSelect className="w-40"><option>One</option><option>Two</option></NativeSelect>
        </Section>

        <Section title="Select / Combobox / Date picker">
          <Select>
            <SelectTrigger className="w-40"><SelectValue placeholder="Pick one" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="x">Option X</SelectItem>
              <SelectItem value="y">Option Y</SelectItem>
            </SelectContent>
          </Select>
          <Combobox options={FRUITS} value={combo} onChange={setCombo} placeholder="Pick a fruit" />
          <DatePicker value={date} onChange={setDate} />
        </Section>

        <Section title="Slider & Progress">
          <Slider defaultValue={[50]} max={100} step={1} className="w-56" />
          <Progress value={60} className="w-56" />
        </Section>

        <Section title="Toggle">
          <Toggle aria-label="Star"><Star className="size-4" /></Toggle>
          <ToggleGroup type="single" defaultValue="b">
            <ToggleGroupItem value="a">A</ToggleGroupItem>
            <ToggleGroupItem value="b">B</ToggleGroupItem>
            <ToggleGroupItem value="c">C</ToggleGroupItem>
          </ToggleGroup>
        </Section>

        <Section title="Overlays">
          <Popover>
            <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
            <PopoverContent>Popover content.</PopoverContent>
          </Popover>
          <HoverCard>
            <HoverCardTrigger asChild><Button variant="link">Hover me</Button></HoverCardTrigger>
            <HoverCardContent>Hover card content.</HoverCardContent>
          </HoverCard>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="outline">Tooltip</Button></TooltipTrigger>
            <TooltipContent>Tooltip text</TooltipContent>
          </Tooltip>
          <Button variant="secondary" onClick={() => toast('Saved', { description: 'Sonner toast fired.' })}>Toast</Button>
        </Section>

        <Section title="Accordion">
          <Accordion type="single" collapsible className="w-full max-w-md">
            <AccordionItem value="a"><AccordionTrigger>Section one</AccordionTrigger><AccordionContent>First panel.</AccordionContent></AccordionItem>
            <AccordionItem value="b"><AccordionTrigger>Section two</AccordionTrigger><AccordionContent>Second panel.</AccordionContent></AccordionItem>
          </Accordion>
        </Section>

        <Section title="Avatar & Skeleton & Spinner">
          <Avatar><AvatarFallback>NB</AvatarFallback></Avatar>
          <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-28" /></div>
          <Spinner />
        </Section>

        <Section title="Navigation">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink href="#">Home</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>Components</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Pagination>
            <PaginationContent>
              <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
              <PaginationItem><PaginationLink href="#" isActive>1</PaginationLink></PaginationItem>
              <PaginationItem><PaginationLink href="#">2</PaginationLink></PaginationItem>
              <PaginationItem><PaginationNext href="#" /></PaginationItem>
            </PaginationContent>
          </Pagination>
        </Section>

        <Section title="Table">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>Ada</TableCell><TableCell>Engineer</TableCell><TableCell><Check className="size-4 text-[var(--positive)]" /></TableCell></TableRow>
              <TableRow><TableCell>Lin</TableCell><TableCell>Designer</TableCell><TableCell><Check className="size-4 text-[var(--positive)]" /></TableCell></TableRow>
            </TableBody>
          </Table>
        </Section>

        <Section title="Typography">
          <div className="max-w-md space-y-2">
            <TypographyH3>The quick brown fox</TypographyH3>
            <TypographyP>Jumps over the lazy dog while the workspace stays out of the way.</TypographyP>
            <Separator />
            <TypographyMuted>Muted caption text.</TypographyMuted>
          </div>
        </Section>
      </div>
    </div>
  );
}
