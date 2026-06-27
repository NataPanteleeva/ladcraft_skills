// Anti-pattern: обход контракта — строить скрипт вокруг прямых runtime-методов VFS без канона handler.
await vfs.writeFile('/workspace/note.txt', 'bad');
const content = await vfs.readFile('/workspace/note.txt');
if (!vfs.exists('/workspace')) {
  await vfs.mkdir('/workspace');
}
returnResult({ content });
