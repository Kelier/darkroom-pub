"""DARKROOM / 30-second product story. Deterministic motion graphics.
Run: python3 render.py   Requires Pillow, numpy and ffmpeg on PATH.
App renders in assets/ are captured from the real DARKROOM renderer.
"""
from pathlib import Path
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
import numpy as np
import math, subprocess, sys, wave
ROOT=Path(__file__).resolve().parent
OUT=ROOT.parent
W,H,FPS=1920,1080,30
BG=(248,247,244); INK=(35,34,32); MUT=(113,110,105); ACC=(168,67,39)
FONT=ROOT/'NotoSansSC.ttf'
@lru_cache(80)
def font(size,weight=400):
 f=ImageFont.truetype(str(FONT),size)
 try:f.set_variation_by_axes([weight])
 except Exception:pass
 return f
@lru_cache(24)
def asset(name):return Image.open(ROOT/'assets'/f'{name}.png').convert('RGBA')
def clamp(x):return max(0.,min(1.,x))
def ease(x):x=clamp(x);return 1-(1-x)**4
def smooth(x):x=clamp(x);return x*x*(3-2*x)
def lerp(a,b,t):return a+(b-a)*t

def text(im,s,x,y,size=64,color=INK,alpha=1,weight=350,anchor=None):
 if alpha<=0:return
 lay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(lay);d.text((round(x),round(y)),s,font=font(size,weight),fill=(*color,round(255*clamp(alpha))),anchor=anchor)
 im.alpha_composite(lay)

def brand(im,opacity=1):
 d=ImageDraw.Draw(im);d.ellipse((171,84,186,99),fill=(*ACC,round(opacity*255)))
 text(im,'DARKROOM',207,69,24,alpha=opacity,weight=550)

def title(im,lines,sub,u,end,x=172,y=350):
 a=ease(u/.65)*(1-smooth((u-(end-.4))/.4));dx=22*(1-ease(u/.8))
 for j,l in enumerate(lines):text(im,l,x+dx,y+j*91,68,alpha=a,weight=350)
 text(im,sub,x+dx,y+len(lines)*91+28,25,MUT,a,350)

def blend(a,b,t):return Image.blend(a,b.resize(a.size,Image.Resampling.LANCZOS),clamp(t))

@lru_cache(80)
def shadow(w,h,radius=5):
 # Authored elevation: warm neutral contact shadow with a soft offset.
 pad=70;c=Image.new('RGBA',(w+2*pad,h+2*pad));d=ImageDraw.Draw(c)
 d.rounded_rectangle((pad+5,pad+24,pad+w-5,pad+h+24),radius=radius,fill=(50,40,27,48))
 return c.filter(ImageFilter.GaussianBlur(24))

def card(im,pic,cx,cy,w,angle=0,opacity=1,paper=12,device=False):
 if opacity<=0:return
 w=max(8,round(w));h=round(w*pic.height/pic.width);pad=70
 content=shadow(w+paper*2,h+paper*2,14 if device else 3).copy()
 d=ImageDraw.Draw(content);d.rounded_rectangle((pad,pad,w+paper*2+pad,h+paper*2+pad),radius=14 if device else 3,fill=(21,21,23,255) if device else (255,254,250,255))
 image=pic.resize((w,h),Image.Resampling.LANCZOS)
 content.alpha_composite(image,(pad+paper,pad+paper))
 if abs(angle)>.01:content=content.rotate(angle,Image.Resampling.BICUBIC,expand=True)
 if opacity<.999:content.putalpha(content.getchannel('A').point(lambda v:round(v*opacity)))
 im.alpha_composite(content,(round(cx-content.width/2),round(cy-content.height/2)))
 return (cx-w/2,cy-h/2,w,h)

STEPS=['导入','构图','胶卷','文字','版式','导出']
def progress(im,index,alpha=1):
 x=172
 for i,s in enumerate(STEPS):
  text(im,s,x,965,21,ACC if i==index else (145,141,134),alpha,500 if i==index else 350)
  if i==index:ImageDraw.Draw(im).line((x,1005,x+42,1005),fill=(*ACC,round(255*alpha)),width=2)
  if i<5:text(im,'/',x+70,965,18,(191,185,175),alpha)
  x+=112

def canister(im,cx,cy,w,name,sub,col,selected=False,opacity=1):
 w=round(w);h=round(w*1.42);pad=50;c=Image.new('RGBA',(w+100,h+100));d=ImageDraw.Draw(c)
 d.ellipse((pad-7,pad+h-4,pad+w+15,pad+h+28),fill=(60,40,20,40));c=c.filter(ImageFilter.GaussianBlur(13));d=ImageDraw.Draw(c)
 d.rounded_rectangle((pad+w*.33,pad-12,pad+w*.67,pad+14),radius=4,fill='#36342f')
 d.rounded_rectangle((pad,pad,pad+w,pad+h),radius=14,fill='#292722')
 for xx in range(w):
  light=.72+.3*math.sin(math.pi*xx/w)+.08*math.exp(-((xx/w-.22)/.15)**2)
  cc=tuple(round(min(255,v*light)) for v in col)
  d.line((pad+xx,pad+19,pad+xx,pad+h-18),fill=cc)
 f=font(max(12,int(w*.15)),500);d.text((pad+w/2,pad+h*.34),name,font=f,fill='#24221d',anchor='mm');d.text((pad+w/2,pad+h*.57),sub,font=font(int(w*.20),600),fill='#24221d',anchor='mm');d.text((pad+w/2,pad+h*.77),'35 mm',font=font(int(w*.10)),fill='#24221d',anchor='mm')
 if selected:d.rounded_rectangle((pad+w*.3,pad+h+12,pad+w*.7,pad+h+15),radius=1,fill=ACC)
 if opacity<1:c.putalpha(c.getchannel('A').point(lambda v:round(v*opacity)))
 im.alpha_composite(c,(round(cx-c.width/2),round(cy-c.height/2)))

def crop_guides(im,box,alpha=1):
 x,y,w,h=box;d=ImageDraw.Draw(im);col=(255,252,236,round(alpha*160))
 lay=Image.new('RGBA',(W,H));q=ImageDraw.Draw(lay)
 for f in [1/3,2/3]:q.line((x+w*f,y,x+w*f,y+h),fill=col,width=1);q.line((x,y+h*f,x+w,y+h*f),fill=col,width=1)
 for xx,yy,sx,sy in [(x,y,1,1),(x+w,y,-1,1),(x,y+h,1,-1),(x+w,y+h,-1,-1)]:q.line((xx,yy+sy*29,xx,yy,xx+sx*29,yy),fill=(*BG,round(alpha*255)),width=4)
 im.alpha_composite(lay)

DARK=(20,24,28); WHITE=(247,244,236)
@lru_cache(80)
def motion(i):return Image.open(ROOT/'assets'/f'motion-{i:03d}.jpg').convert('RGBA')
def pill(im,s,x,y,active=False):
 d=ImageDraw.Draw(im);width=int(font(21).getlength(s))+40
 d.rounded_rectangle((x,y,x+width,y+43),radius=21,fill=ACC if active else (231,227,219))
 text(im,s,x+20,y+7,21,WHITE if active else MUT,weight=450)
def heading(im,num,label,title,sub,dark=False):
 c=WHITE if dark else INK
 text(im,num+'  /  '+label,110,68,23,ACC if not dark else (218,163,103),weight=500)
 text(im,title,110,112,60,c,weight=450)
 text(im,sub,112,207,24,(167,172,174) if dark else MUT)
def scene(t):
 im=Image.new('RGBA',(W,H),(*BG,255))
 if t<2.7:
  u=t;e=ease(u/.65)
  text(im,'DARKROOM',105,67,25,ACC,weight=550)
  text(im,'一张照片，',110,250,79,alpha=e,weight=450)
  text(im,'不止一种可能。',110,355,79,alpha=e,weight=450)
  text(im,'识别主体  /  绕排文字  /  深度动效',116,515,25,MUT,alpha=e)
  for j,n in enumerate(['gig','movie','magazine']):
   card(im,asset(n),1120+j*208+40*(1-e),570+(-1 if j%2 else 1)*55,355+25*j,angle=[10,0,-10][j]*e,opacity=e)
  text(im,'YOUR PHOTO. REIMAGINED.',116,931,21,MUT)
 elif t<7:
  u=t-2.7;heading(im,'01','SUBJECT-AWARE','先看懂主角，再决定构图。','识别人物位置，为不同画幅安排焦点与留白。')
  e=ease(u/.65);box=card(im,asset('original'),405,615,410,opacity=e)
  if box:
   x,y,w,h=box;d=ImageDraw.Draw(im);bb=(x+w*.3898,y+h*.3382,x+w*.6194,y+h*.9861)
   d.rounded_rectangle(bb,radius=6,outline=ACC,width=3)
   text(im,'PERSON',bb[0],bb[1]-30,19,ACC)
   sy=y+h*((u*.32)%1);d.line((x,sy,x+w,sy),fill=(235,161,97),width=2)
  for j,(n,cx,cy,w,label) in enumerate([('smart-1-1',960,570,345,'1:1'),('smart-3-4',1430,600,350,'3:4')]):
   a=ease((u-.5-j*.28)/.6);card(im,asset(n),cx,cy+60*(1-a),w,opacity=a);pill(im,label,cx-35,888,True)
  text(im,'主体识别 → 智能构图',750,958,24,MUT)
 elif t<12:
  u=t-7;heading(im,'02','SUBJECT × TYPE','让文字，走进照片。','主体遮挡 + 古典明朝绕排，让文字与人物拥有前后关系。')
  cut=smooth((u-.7)/1.1);a=asset('front');b=asset('behind');pic=a.copy();x=round(a.width*cut)
  if x:pic.paste(b.crop((0,0,x,b.height)),(0,0))
  card(im,pic,505,636,440)
  card(im,asset('type'),1180,636,440,angle=-3*ease(u/.6))
  pill(im,'文字置于人物后方',349,963,True);pill(im,'明朝 · 自动环绕',1040,963,True)
  text(im,'9',1640,439,116,ACC,weight=500,anchor='mt');text(im,'种绕排',1640,589,27,MUT,anchor='mt')
  text(im,'光环 / 轮廓',1640,664,24,MUT,anchor='mt');text(im,'波浪 / 螺旋',1640,710,24,MUT,anchor='mt')
 elif t<18:
  u=t-12;im=Image.new('RGBA',(W,H),(*DARK,255));heading(im,'03','DEPTH → MOTION','平面的照片，也有空间感。','AI 深度估计驱动 2.5D 视差；轻推镜头，看前后景错开。',True)
  e=ease(u/.6)
  dep=ImageOps.colorize(asset('depth').convert('L'),(22,32,47),(234,177,104)).convert('RGBA')
  card(im,dep,416,635,385,opacity=e,paper=0)
  text(im,'DEPTH MAP',416,947,22,(195,165,121),anchor='mt')
  f=clamp((u-.4)/5.6)*71;idx=int(f)
  frame=blend(motion(idx),motion(min(71,idx+1)),f-idx)
  card(im,frame,1195,628,490,paper=0)
  text(im,'2.5D PARALLAX',1195,977,22,WHITE,anchor='mt')
  d=ImageDraw.Draw(im);d.line((699,593,804,593),fill=(144,155,164),width=2);d.polygon([(804,593),(792,586),(792,600)],fill=(144,155,164))
  text(im,'AI 推断深度 · 非真实三维重建',1774,929,19,(145,151,156),anchor='rt')
 elif t<24:
  u=t-18;heading(im,'04','KEEP THE LOOK. ROLL THE LAYOUT.','保留胶片，重写整张版式。','同一张照片，从杂志封面，到横向书页，再到演出海报。')
  for j,(n,cx,ww) in enumerate([('magazine',385,348),('book',963,492),('gig',1535,353)]):
   e=ease((u-j*.3)/.75);angle=[4,0,-4][j]*(1-smooth((u-2.7)/1.2))
   card(im,asset(n),cx,640+100*(1-e),ww,angle=angle,opacity=e)
   text(im,['MAGAZINE','PHOTO BOOK','GIG POSTER'][j],cx,963,22,MUT,alpha=e,anchor='mt')
  pill(im,'胶片参数保持',811,293,True)
 elif t<27:
  u=t-24;heading(im,'05','LOAD A ROLL','色彩的变化，看得见。','点击胶卷装载质感；一键回到底片，继续大胆尝试。')
  a=asset('crop');b=asset('warm');pic=a.copy();cut=round(a.width*smooth(u/1.2))
  if cut:pic.paste(b.crop((0,0,cut,b.height)),(0,0))
  card(im,pic,1330,642,450)
  canister(im,330,560,150,'Golden','200',(221,180,79),True)
  canister(im,570,560,150,'Airy','400',(159,181,144))
  canister(im,810,560,150,'Mono','400',(177,177,174))
  text(im,'9 款胶片预设',330,760,28,MUT)
  pill(im,'一键还原底片',327,830,True)
 else:
  u=t-27;e=ease(u/.55)
  for j,n in enumerate(['gig','type','movie','magazine','borderpoem']):card(im,asset(n),495+j*230,330+abs(j-2)*22,215,angle=(2-j)*5,opacity=e)
  text(im,'DARKROOM',960,617,100,INK,e,500,'mt')
  text(im,'底片不变，表达自由。',960,759,38,MUT,e,400,'mt')
  text(im,'本地运行  /  非破坏编辑  /  从浏览器导出',960,885,25,ACC,e,400,'mt')
 return im.convert('RGB')

def soundtrack():
 sr=44100;n=30*sr;t=np.arange(n)/sr;out=np.zeros(n);beat=.6
 # Original 100 BPM electronic score. Delicate mallets + bass + soft percussion.
 chords=[[146.832,174.614,220,261.626],[130.813,164.814,195.998,246.942],[110,138.591,164.814,220],[130.813,164.814,195.998,261.626]]
 for k in range(50):
  start=k*beat;u=t-start;valid=(u>=0)&(u<2.3);v=u[valid];ch=chords[(k//8)%4];f=ch[k%4]*2
  env=np.exp(-v*4.2)*(1-np.exp(-v*100));out[valid]+=.085*env*(np.sin(2*np.pi*f*v)+.24*np.sin(2*np.pi*f*2.01*v))
  if k%2==0:
   hit=(u>=0)&(u<.35);v=u[hit];out[hit]+=.05*np.sin(2*np.pi*(58*v-24*v*v))*np.exp(-v*18)
  if k%4==0:
   valid=(u>=0)&(u<2.2);v=u[valid];f=ch[0]/2;out[valid]+=.032*np.sin(2*np.pi*f*v)*np.sin(np.pi*np.minimum(v/2.2,1))
 fade=np.minimum(np.minimum(t/1.4,(30-t)/1.5),1).clip(0,1);out*=fade
 rng=np.random.default_rng(6)
 for k in range(50):
  a=int(k*beat*sr);count=min(int(.06*sr),n-a);out[a:a+count]+=.009*rng.standard_normal(count)*np.exp(-np.arange(count)/(sr*.01))*fade[a:a+count]
 stereo=np.stack((out,np.roll(out,110)*.92),axis=1);pcm=(np.clip(stereo,-.9,.9)*32767).astype('<i2')
 path=ROOT/'score.wav'
 with wave.open(str(path),'wb')as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr);f.writeframes(pcm.tobytes())
 return path

if __name__=='__main__':
 if '--stills' in sys.argv:
  sheet=Image.new('RGB',(1920,1080),BG)
  for i,t in enumerate([1.5,5.3,9.5,14.4,16.8,21.6,25.5,28.8]):
   frame=scene(t);frame.save(ROOT/f'frame-{i}.jpg',quality=93);sheet.paste(frame.resize((480,270)),((i%4)*480,(i//4)*270))
  sheet.crop((0,0,1920,540)).save(ROOT/'storyboard.jpg',quality=93);print('Storyboard ready',flush=True);sys.exit()
 audio=soundtrack();target=OUT/'darkroom-demo.mp4'
 cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(audio),'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-t','30','-movflags','+faststart',str(target)]
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 try:
  for i in range(30*FPS):
   p.stdin.write(scene(i/FPS).tobytes())
   if i%(FPS*3)==0:print(f'{i//FPS}/30 seconds rendered',flush=True)
 finally:p.stdin.close()
 if p.wait()!=0:raise RuntimeError('ffmpeg encode failed')
 scene(9.5).save(OUT/'demo-cover.jpg',quality=95)
 print(str(target),flush=True)
