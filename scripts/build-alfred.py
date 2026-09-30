#!/usr/bin/env python3
"""Build a portable Alfred 5 keyword + Universal Text Action workflow."""
import pathlib, plistlib, zipfile, shutil, uuid
root = pathlib.Path(__file__).resolve().parents[1]
output = root / 'integrations' / 'alfred' / 'workflow'
output.mkdir(parents=True, exist_ok=True)
keyword, action, script, notification = [str(uuid.uuid5(uuid.NAMESPACE_URL, 'local.margin.notes.capture/' + name)).upper() for name in ['keyword', 'text-action', 'capture-script', 'notification']]
objects = [
 {'uid': keyword, 'type': 'alfred.workflow.input.keyword', 'version': 1, 'config': {'keyword': 'n', 'argumenttype': 1, 'withspace': True, 'text': 'Save to Margin', 'subtext': 'Save your text to Inbox · leave blank to capture the clipboard'}},
 {'uid': action, 'type': 'alfred.workflow.trigger.universalaction', 'version': 1, 'config': {'name': 'Save to Margin', 'acceptsfiles': False, 'acceptsmulti': 0, 'acceptstext': True, 'acceptsurls': True}},
 {'uid': script, 'type': 'alfred.workflow.action.script', 'version': 2, 'config': {'type': 0, 'script': '/usr/bin/osascript -l JavaScript capture.js "$1"', 'scriptargtype': 1, 'escaping': 102, 'scriptfile': '', 'concurrently': False}},
 {'uid': notification, 'type': 'alfred.workflow.output.notification', 'version': 1, 'config': {'title': 'Margin Notes', 'text': '{query}', 'lastpathcomponent': False, 'removeextension': False, 'onlyshowifquerypopulated': True}},
]
def connect(destination): return [{'destinationuid': destination, 'modifiers': 0, 'modifiersubtext': '', 'vitoclose': False}]
info = {'name': 'Margin Quick Capture', 'bundleid': 'local.margin.notes.capture', 'createdby': 'Margin', 'description': 'Save text to Margin with n or a Universal Text Action.', 'version': '1.0.0', 'disabled': False, 'objects': objects,
        'connections': {keyword: connect(script), action: connect(script), script: connect(notification)},
        'uidata': {keyword: {'xpos': 60, 'ypos': 60}, action: {'xpos': 60, 'ypos': 200}, script: {'xpos': 330, 'ypos': 120}, notification: {'xpos': 600, 'ypos': 120}},
        'variables': {'margin_app': ''}, 'variablesdontexport': [],
        'userconfigurationconfig': [{'type': 'textfield', 'config': {'variable': 'margin_app', 'label': 'Margin app path', 'description': 'Optional. Leave blank to find Margin in Applications or ~/Projects/Margin/release/mac-arm64.', 'default': '', 'required': False, 'trim': True}}],
        'readme': 'Type n followed by text to save a note in Inbox. Type n alone to capture your clipboard. Select text and choose Save to Margin in Alfred Universal Actions. The workflow saves through Margin’s bundled runtime, including while Margin is closed. In demo mode captures go to the temporary demo notebook.'}
with (output / 'info.plist').open('wb') as handle: plistlib.dump(info, handle)
shutil.copyfile(root / 'integrations' / 'alfred' / 'capture.js', output / 'capture.js')
# Export the app icon for Alfred without changing it.
import subprocess
subprocess.run(['/usr/bin/sips', '-s', 'format', 'png', str(root / 'assets' / 'icon.icns'), '--out', str(output / 'icon.png')], check=True, stdout=subprocess.DEVNULL)
archive = root / 'integrations' / 'alfred' / 'Margin Quick Capture.alfredworkflow'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as handle:
 for name in ['info.plist', 'capture.js', 'icon.png']: handle.write(output / name, name)
print(archive)
