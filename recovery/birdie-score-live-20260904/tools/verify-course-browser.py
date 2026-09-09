"""Local preview checks. Requires Python Playwright and Chromium, no live app.
Run after npm run preview:course. Browser content is loaded directly in memory.
"""
from pathlib import Path
import json
import shutil
import time
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'dist-course/BirdieWorld_Course_Flight_v1.html').read_text()
OUT = ROOT / 'dist-course'
checks = []
def check(name, ok):
    checks.append({'name': name, 'pass': bool(ok)})
    assert ok, name
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':1366,'height':960})
    errors = []
    requests = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda e: errors.append(e.text) if e.type == 'error' else None)
    page.on('request', lambda r: requests.append(r.url))
    page.set_content(HTML)
    page.wait_for_timeout(200)
    status = lambda: page.evaluate('window.__coursePreview.controller.status()')
    def wait_phase(phase, timeout=7000):
        deadline=time.monotonic()+timeout/1000
        while time.monotonic()<deadline:
            if status()['phase']==phase:return
            page.wait_for_timeout(35)
        raise AssertionError('Timed out waiting for '+phase)
    check('desktop initial idle has no animation loop', status()['phase'] == 'idle' and status()['pendingFrames'] == 0)
    page.screenshot(path=str(OUT/'Course_Desktop_Idle.png'),full_page=True)
    page.click('#hit')
    check('shot begins with swing', status()['phase'] == 'swing')
    wait_phase('flight')
    page.wait_for_timeout(600)
    check('flight visible with one scheduled frame', status()['phase'] == 'flight' and status()['pendingFrames'] == 1)
    page.screenshot(path=str(OUT/'Course_Desktop_Flight.png'),full_page=True)
    check('same snapshot ID cannot retrigger or allocate another loop', page.evaluate('!window.__coursePreview.controller.play(window.__coursePreview.shot)') and status()['pendingFrames'] == 1)
    wait_phase('done')
    check('settled shot stops its animation loop', status()['pendingFrames'] == 0)
    page.click('#replay');page.wait_for_timeout(300);page.click('#reset')
    check('reset during flight cancels animation and returns idle', status()['phase'] == 'idle' and status()['pendingFrames'] == 0)
    page.click('#hit');page.wait_for_timeout(350)
    # Synthetic document visibility transition: does not claim OS tab testing.
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
    before=status()['elapsedMs'];page.wait_for_timeout(180)
    check('simulated hidden document pauses time and RAF', status()['elapsedMs'] == before and status()['pendingFrames'] == 0)
    page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(180)
    check('document visibility resumes one loop without large jump', before < status()['elapsedMs'] < before + 400 and status()['pendingFrames'] == 1)
    page.evaluate("document.getElementById('course').style.display='none'");page.wait_for_timeout(150)
    check('offscreen canvas pauses its animation', status()['pendingFrames'] == 0)
    page.evaluate("document.getElementById('course').style.display='block'");page.wait_for_timeout(100)
    page.check('#reduced');page.click('#hit')
    check('manual reduced motion skips animation', status()['phase'] == 'done' and status()['pendingFrames'] == 0)
    page.uncheck('#reduced');page.emulate_media(reduced_motion='reduce');page.click('#hit')
    check('OS reduced motion preference is honored', status()['phase'] == 'done' and status()['pendingFrames'] == 0)
    page.emulate_media(reduced_motion='no-preference')
    page.select_option('#hole','2');page.fill('#timing','0');page.click('#hit')
    wait_phase('penalty')
    check('water miss shows penalty phase and engine penalty', page.evaluate('window.__coursePreview.shot.result.penalty === 1'))
    wait_phase('done')
    check('water drop returns to exact official starting spot', page.evaluate('window.CoursePreviewModules.sampleCourseShot(window.__coursePreview.shot,1e9).z === 0'))
    page.select_option('#scenario','putt');page.fill('#timing','75');page.click('#hit')
    wait_phase('roll')
    check('putt enters ground roll without flight', page.evaluate('window.__coursePreview.shot.flightMs === 0'))
    page.evaluate('window.__coursePreview.controller.destroy();window.__coursePreview.controller.destroy()')
    check('destroy is idempotent and prevents further playback', status()['destroyed'] and status()['pendingFrames']==0 and page.evaluate('!window.__coursePreview.controller.play(window.__coursePreview.shot)'))
    page.evaluate('window.__coursePreview.mount()')
    check('remount is independently usable', not status()['destroyed'] and status()['phase']=='idle')
    check('unsupported canvas fails with explicit error',page.evaluate("""() => {const c=document.createElement('canvas');c.getContext=()=>null;try{window.CoursePreviewModules.createCourseScene(c,{hole:window.CoursePreviewModules.COURSE_HOLES[0]});return false;}catch(e){return e.message.includes('unavailable');}}"""))
    for width in [390,320]:
        page.close()
        page = browser.new_page(viewport={'width':width,'height':844})
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.on('console',lambda e: errors.append(e.text) if e.type == 'error' else None)
        page.on('request',lambda r: requests.append(r.url))
        page.set_content(HTML);page.wait_for_timeout(200)
        check(f'mobile {width}px has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.click('#hit');page.wait_for_timeout(750)
        check(f'mobile {width}px shot animates',status()['phase']=='flight')
        if width==390:
            page.screenshot(path=str(OUT/'Course_Mobile_Flight.png'),full_page=True)
    check('no JavaScript or console errors',not errors)
    check('offline preview makes no network requests',not requests)
    browser.close()
result={'scope':'local standalone preview; not a React host or live-device acceptance','browser':'Chromium (headless)','passed':sum(c['pass'] for c in checks),'total':len(checks),'checks':checks,'errors':errors,'requests':requests}
(OUT/'course-browser-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
