import { File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideProps } from 'lucide-react';
import { extensionOf, fileKind, type FileKind } from '../../main/file-kinds';

const KINDS: Record<string, typeof File> = {
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage, webp: FileImage, bmp: FileImage, ico: FileImage, avif: FileImage, heic: FileImage,
  txt: FileText, log: FileText, pdf: FileText, doc: FileText, docx: FileText, rtf: FileText, odt: FileText,
  csv: FileSpreadsheet, tsv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet, ods: FileSpreadsheet,
  zip: FileArchive, '7z': FileArchive, rar: FileArchive, tar: FileArchive, gz: FileArchive, tgz: FileArchive,
};

const BY_KIND: Partial<Record<FileKind, typeof File>> = { image: FileImage, video: FileVideo, audio: FileAudio, text: FileCode };

/** The icon for a file by its kind: the opened media and text kinds, and files Neuron lists but does not open. */
export default function OtherFileIcon({ path, ...props }: { path: string } & LucideProps) {
  const Icon = KINDS[extensionOf(path)] ?? BY_KIND[fileKind(path)] ?? File;
  return <Icon {...props} />;
}
