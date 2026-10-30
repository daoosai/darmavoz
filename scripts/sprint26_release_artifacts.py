"""Read-only verification of the immutable TEST APK, including binary manifest.

No credentials, signing material or server environment contents are emitted.
"""
import hashlib,json,re,struct,subprocess,sys,urllib.request,zipfile
from pathlib import Path
BASE='https://test.darmavoz.ru'
ROOT=Path('/opt/darmavoz_test')

def binary_manifest(data):
    strings=[];position=8
    def u16(offset):return struct.unpack_from('<H',data,offset)[0]
    def u32(offset):return struct.unpack_from('<I',data,offset)[0]
    def length8(offset):
        value=data[offset];return (((value&127)<<8)|data[offset+1],offset+2) if value&128 else (value,offset+1)
    def length16(offset):
        value=u16(offset);return (((value&32767)<<16)|u16(offset+2),offset+4) if value&32768 else (value,offset+2)
    while position<len(data):
        kind,header,size=struct.unpack_from('<HHI',data,position)
        assert size>=header>=8 and position+size<=len(data)
        if kind==1:
            count=u32(position+8);utf8=bool(u32(position+16)&256);start=position+u32(position+20)
            for i in range(count):
                offset=start+u32(position+header+i*4)
                if utf8:
                    _,offset=length8(offset);length,offset=length8(offset);value=data[offset:offset+length].decode('utf-8')
                else:
                    length,offset=length16(offset);value=data[offset:offset+length*2].decode('utf-16le')
                strings.append(value)
        elif kind==0x102 and strings[u32(position+20)]=='manifest':
            start=position+16+u16(position+24);width=u16(position+26);count=u16(position+28);attrs={}
            for i in range(count):
                offset=start+i*width;name=strings[u32(offset+4)];raw=u32(offset+8);dtype=data[offset+15];value=u32(offset+16)
                attrs[name]=strings[raw] if raw!=0xffffffff else strings[value] if dtype==3 else value
            return {k:attrs[k] for k in ['package','versionName','versionCode']}
        position+=size
    raise ValueError('APK_MANIFEST_NOT_FOUND')

def main():
    release=sys.argv[1];assert re.fullmatch('[0-9a-f]{40}',release)
    manifest=json.load(urllib.request.urlopen(BASE+'/static/darmavoz-test-build.json',timeout=30))
    # Keep the public manifest format independent of private build credentials.
    print(json.dumps({'manifest_keys':list(manifest)}))
    assert release in json.dumps(manifest),'PUBLIC_MANIFEST_IS_NOT_REQUESTED_RELEASE'
    url=BASE+'/static/darmavoz-test-'+release+'.apk';target=Path('/tmp/darmavoz-test-'+release+'.apk')
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=manifest['sha256']:
        with urllib.request.urlopen(url,timeout=90) as response:target.write_bytes(response.read())
    digest=hashlib.sha256(target.read_bytes()).hexdigest()
    assert digest in json.dumps(manifest),'APK_HASH_DOES_NOT_MATCH_PUBLIC_MANIFEST'
    with zipfile.ZipFile(target) as apk:
        attrs=binary_manifest(apk.read('AndroidManifest.xml'))
        capacitor=json.loads(apk.read('assets/capacitor.config.json'))
        scripts=b'\n'.join(apk.read(name) for name in apk.namelist() if name.startswith('assets/public/') and name.endswith('.js'))
        assert attrs=={'package':'ru.darmavoz.app.test','versionName':'3.3.3','versionCode':391},attrs
        assert capacitor['appId']=='ru.darmavoz.app.test' and capacitor['appName']=='Дармавоз ТЕСТ'
        assert b'https://test.darmavoz.ru/api/v1' in scripts and b'https://darmavoz.ru/api/v1' not in scripts
        embedded_marker=release.encode() in scripts
        info=json.loads(subprocess.check_output(['docker','inspect','backend_test']))[0]
        env=dict(x.split('=',1) for x in info['Config']['Env'] if '=' in x)
        for key in ['YOOKASSA_SECRET_KEY','SECRET_KEY']:
            if env.get(key):assert env[key].encode() not in scripts,'SERVER_SECRET_FOUND_IN_CLIENT_BUNDLE'
    report={'commit':release,'environment':'test','url':url,'bytes':target.stat().st_size,'sha256':digest,'binary_manifest':attrs,
        'capacitor_app_id':capacitor['appId'],'capacitor_app_name':capacitor['appName'],'test_api_only':True,'server_secrets_absent':True,
        'download_hash_verified':True,'embedded_commit_marker':embedded_marker,'release_identity':'immutable artifact name + CI manifest commit + SHA256','physical_device_tested':False,'manifest_url':BASE+'/static/darmavoz-test-build.json'}
    (ROOT/'docs/reports/sprint26/android-artifact.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
