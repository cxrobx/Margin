ObjC.import('Foundation');
ObjC.import('AppKit');
function environment(name) {
  var value = $.NSProcessInfo.processInfo.environment.objectForKey(name);
  return value.isNil() ? '' : ObjC.unwrap(value);
}
function run(argv) {
  var text = argv[0] || '';
  if (!text.trim()) {
    var pasteboard = $.NSPasteboard.generalPasteboard;
    if (pasteboard.isNil()) throw new Error('Alfred could not read the clipboard. Copy text and try again.');
    var clipboard = pasteboard.stringForType($.NSPasteboardTypeString);
    text = clipboard.isNil() ? '' : ObjC.unwrap(clipboard);
  }
  if (!text.trim()) return 'Copy some text first, or type n followed by your note.';
  var home = ObjC.unwrap($.NSHomeDirectory());
  var candidates = [environment('margin_app'), '/Applications/Margin Notes.app', home + '/Applications/Margin Notes.app', home + '/Projects/Margin/release/mac-arm64/Margin Notes.app'].filter(Boolean);
  var appPath = candidates.find(function (candidate) { return $.NSFileManager.defaultManager.fileExistsAtPath(candidate + '/Contents/Resources/app/scripts/capture.mjs'); });
  if (!appPath) throw new Error('Margin Notes could not be found. Set the Margin app path in this workflow’s configuration.');
  var task = $.NSTask.alloc.init;
  task.launchPath = appPath + '/Contents/MacOS/Margin Notes';
  task.arguments = [appPath + '/Contents/Resources/app/scripts/capture.mjs'];
  var env = { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin', HOME: home };
  var dataDir = environment('MARGIN_DATA_DIR');
  if (dataDir) env.MARGIN_DATA_DIR = dataDir;
  task.environment = env;
  var input = $.NSPipe.pipe, output = $.NSPipe.pipe, errors = $.NSPipe.pipe;
  task.standardInput = input; task.standardOutput = output; task.standardError = errors;
  task.launch;
  input.fileHandleForWriting.writeData($(text).dataUsingEncoding($.NSUTF8StringEncoding));
  input.fileHandleForWriting.closeFile;
  task.waitUntilExit;
  var result = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(output.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding));
  var error = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(errors.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding));
  if (task.terminationStatus !== 0) throw new Error(error.trim() || 'Margin could not save this capture.');
  var saved = JSON.parse(result);
  return 'Saved ' + (saved.demoMode ? 'to demo notebook: ' : 'to Inbox: ') + saved.title;
}
