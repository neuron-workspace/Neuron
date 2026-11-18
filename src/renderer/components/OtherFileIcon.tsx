import { File, FileArchive, FileImage, FileSpreadsheet, FileText, type LucideProps } from 'lucide-react';

const KINDS: Record<string, typeof File> = {
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage, bmp: FileImage, ico: FileImage, avif: FileImage, heic: FileImage,
  txt: FileText, pdf: FileText, doc: FileText, docx: FileText, rtf: FileText, odt: FileText,
  csv: FileSpreadsheet, tsv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet, ods: FileSpreadsheet,
  zip: FileArchive, '7z': FileArchive, rar: FileArchive, tar: FileArchive, gz: FileArchive, tgz: FileArchive,
};

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** The icon for a file Neuron lists but does not open, by its kind. */
export default function OtherFileIcon({ path, ...props }: { path: string } & LucideProps) {
  const Icon = KINDS[extensionOf(path)] ?? File;
  return <Icon {...props} />;
}
