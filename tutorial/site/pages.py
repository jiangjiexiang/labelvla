"""文档站各页正文（占位符由 build.py 替换）。"""

def steps(*items):
    lis = ''.join(f'<li><b>{t}</b>{d}</li>' for t, d in items)
    return f'<ol class="steps">{lis}</ol>'


def stepfig(name, title, text=''):
    """一步一图：编号小标题 + 带标注的截图 + 一句说明。"""
    body = f'<b>{title}</b>' + (f'<span>{text}</span>' if text else '')  # 标题已含「第 N 步」
    return (f'<figure class="step"><figcaption class="step-title">{body}</figcaption>'
            f'<img data-rel="images/steps/{name}.jpg" src="../images/steps/{name}.jpg" alt="{title}" loading="lazy"></figure>')


PAGES = {}

# ── 概览 ──
PAGES['index.html'] = dict(
    title='概览', crumbs=[], toc=[],
    body='''
<h1>使用 LabelVLA 完成一次数据标注</h1>
<p class="lead">本套文档以 3 条 Episode 的示例数据集为例，走一遍从建任务到发布新版本的完整流程。每个章节一页，用左侧导航按顺序阅读；照着做一遍约 15 分钟。</p>
<p class="lead">示例数据集：<code>tutorial_demo_template</code> · 3 个相机 · 30 FPS<br>登录账号：管理员 <code>admin</code> / <code>admin123</code></p>

<h2>平台的流转方式</h2>
<p>每个标注任务按同一套节点执行，人工只介入中间两步：</p>
<table>
  <tr><th>节点</th><th>由谁执行</th><th>做什么</th></tr>
  <tr><td>预处理</td><td>系统</td><td>读取元数据，清点视频和 Parquet</td></tr>
  <tr><td>人工标注</td><td>标注负责人</td><td>在 Studio 划分片段、写描述、标目标框</td></tr>
  <tr><td>人工验收</td><td>审核负责人</td><td>播放视频，通过或打回</td></tr>
  <tr><td>程序质检</td><td>系统</td><td>逐条检查是否都标注了（或填写跳过原因）</td></tr>
  <tr><td>版本发布</td><td>系统</td><td>输出独立版本和文件校验摘要</td></tr>
</table>

<h2>按角色看</h2>
<p>三个人各有一套页面，只讲自己要用到的操作；想把整套流程走一遍，再看后面的「操作指南」。</p>
<div class="cards">
  <a class="card" href="role-admin.html"><b>管理员</b><span>账号、数据集、任务调度与接手</span></a>
  <a class="card" href="role-annotator.html"><b>标注员</b><span>领取任务、标注、保存、提交</span></a>
  <a class="card" href="role-reviewer.html"><b>审核员</b><span>验收视频、通过或写清原因打回</span></a>
</div>

<h2>参考</h2>
<p>操作细节都写在对应角色的页面里，这一页只做两件事：先看一遍流程，遇到报错再查常见问题。</p>
<div class="cards">
  <a class="card" href="demo.html"><b>流程演示</b><span>33 秒连续录屏，先看一遍整体流程</span></a>
  <a class="card" href="faq.html"><b>常见问题</b><span>报错提示与处理办法</span></a>
  <a class="card" href="shortcuts.html"><b>快捷键</b><span>保存、SAM 修正等按键</span></a>
</div>
''')

# ── 流程演示 ──
PAGES['demo.html'] = dict(
    title='流程演示',
    crumbs=[('概览', 'index.html')],
    toc=[('录屏', 'demo'), ('示例数据', 'data')],
    body='''
<h1>流程演示</h1>
<p class="lead">下面这段录屏没有剪辑：登录、建任务、划片段、SAM 分割、审核、发布依次进行，页面顶部的黑条会说明每一步在做什么。</p>

<div class="video">
  <video controls preload="metadata" playsinline poster="{{POSTER}}">
    <source src="{{VIDEO_MAIN}}" type="video/mp4">
    你的浏览器不支持 video 标签。
  </video>
  <div class="video-cap"><b>流程演示</b><span>33 秒 · 1280×768 · 无配音</span></div>
</div>

<h2 id="data">示例数据说明</h2>
<p>录屏使用的是 <code>tutorial_demo_template</code>：3 条 Episode、3 个相机、30 FPS，每条 20 秒。标注示例是「抓取食物 → 放到托盘 → 回到初始位」三个动作片段，以及被抓取的那个碗的目标框。</p>
<p>你自己的数据集只要符合 LeRobot v2.x / v3.0 目录结构，放进 <code>data/</code> 并「重新扫描」就能在数据管理里看到。</p>
''')

# ── 1. 登录 ──
# ── 2. 新建任务 ──
# ── 3. 工作台 ──
# ── 4. SAM ──
# ── 5. 保存提交 ──
# ── 常见问题 ──
PAGES['faq.html'] = dict(
    title='常见问题', crumbs=[('概览', 'index.html')], toc=[],
    body='''
<h1>常见问题</h1>
<table>
  <tr><th>现象</th><th>处理</th></tr>
  <tr><td>提示「请先在 Studio 点击保存修改」</td><td>工作区还有未写回的改动：回到工作区点顶部「保存修改」，等「已保存」后再提交。</td></tr>
  <tr><td>右侧没有「SAM 点选分割」</td><td>需要先选中一个片段；只读的审核模式下也不会出现。</td></tr>
  <tr><td>SAM 返回很大的框</td><td>没点中目标：点「放弃对象」重新点，或换到视野更完整的相机。</td></tr>
  <tr><td>传播跟踪进度长时间不动</td><td>推理服务排队或显存不足，稍等或联系管理员重启 SAM 服务。</td></tr>
  <tr><td>提示「资源加载失败」</td><td>点选那一帧还没有轮廓，传播跟踪跑完后会正常。关掉弹窗继续操作即可。</td></tr>
  <tr><td>提示「标注已被其他会话修改」</td><td>同一条 Episode 被别处保存过：刷新页面重新加载后再改。</td></tr>
  <tr><td>程序质检不通过</td><td>多半还有 Episode 没标注：用「转回节点」退回标注节点，补完再提交。</td></tr>
  <tr><td>点「完成人工标注」没反应</td><td>任务必须先保存修改；确认本人是任务负责人或管理员。</td></tr>
  <tr><td>管理员密码忘了</td><td>默认是 <code>admin123</code>（首次部署未改密时为 <code>admin</code>）。都登录不了就让管理员在「用户管理」里重置，或联系部署方处理数据库。</td></tr>
</table>
''')

# ── 快捷键 ──
PAGES['shortcuts.html'] = dict(
    title='快捷键', crumbs=[('概览', 'index.html')], toc=[],
    body='''
<h1>快捷键</h1>
<table>
  <tr><th>按键</th><th>作用</th></tr>
  <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd></td><td>保存当前 Episode 的标注</td></tr>
  <tr><td><kbd>Shift</kbd>+点击</td><td>SAM 模式下添加负点，修正分割轮廓</td></tr>
  <tr><td><kbd>Esc</kbd></td><td>退出 SAM 模式、关闭弹窗</td></tr>
  <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>选中播放条后逐帧前后移动</td></tr>
</table>
<div class="note warn"><b>当前版本未生效：</b>界面底部提示的 <kbd>Q</kbd> 起点、<kbd>R</kbd> 终点、<kbd>Enter</kbd> 新建片段快捷键不能用，请用鼠标点轨道和拖拽边界。</div>
''')

# ── 角色 ──
# ── 按角色：标注员 ──
# ── 按角色：审核员 ──

# ── 按角色：管理员 ──
PAGES['role-admin.html'] = dict(
    title='管理员',
    crumbs=[('概览', 'index.html')],
    toc=[('能做什么', 'can'), ('管账号', 'accounts'), ('导数据', 'data'), ('建任务', 'task'),
         ('接手别人的任务', 'handover'), ('查看与发布结果', 'result')],
    body='''
<h1>管理员</h1>
<p class="lead">管理员的日常是管账号、导数据、建任务，以及在流程卡住时兜底。标注和审核也可以自己做。本页按这四个部分给出完整操作，每一步都配图。</p>
<p class="lead">登录账号 <code>admin</code> / <code>admin123</code>（新部署未改过密码时为 <code>admin</code>）。</p>

<h2 id="can">能做什么</h2>
<table>
  <tr><th>模块</th><th>能做的事</th></tr>
  <tr><td>数据管理</td><td>查看全部数据集、重新扫描、移入回收站与恢复、改机器人标签</td></tr>
  <tr><td>用户管理</td><td>新建账号、改角色、停用/删除、绑定钉钉、查看登录记录<sup>①</sup></td></tr>
  <tr><td>任务管理</td><td>新建任务、取消、重试、编辑流程、转回节点、强制流转</td></tr>
  <tr><td>标注 / 审核</td><td>打开任意任务的工作区，可编辑也可验收</td></tr>
</table>
<p><sup>①</sup> 界面目前提供新建账号和改角色；改密码、重置密码走接口或数据库，本页不展开。</p>

<h2 id="accounts">管账号</h2>
''' + stepfig('login-1', '第 1 步　登录', '① 用户名　② 密码　③ 点「登录」；首次登录会要求改密码') + '''
''' + stepfig('admin-1', '第 2 步　看整体进度', '数据看板：数据集与标注总量、标注状态分布、质检通过率、近期趋势') + '''
''' + stepfig('admin-2', '第 3 步　新建账号和分配角色',
              '用户管理里：① 新建账号（填初始密码，至少 6 位）　② 修改已有账号的角色') + '''
<div class="note">别用管理员账号给团队分工。管理员能开任意任务，出问题时分不清责任：给标注的人开标注员账号，给验收的人开审核员账号。</div>

<h2 id="data">导数据</h2>
''' + stepfig('admin-3', '第 4 步　把数据集放进平台',
              '数据集放进 <code>data/</code> 后点右上角「重新扫描」；暂时不用的可以移到回收站，之后能恢复') + '''
<p>数据集需要符合 LeRobot v2.x / v3.0 目录结构。扫描完成后，列表里能看到条数、时长、相机数和标注进度。</p>
''' + stepfig('datasets-1', '第 5 步　确认数据可用',
              '① 找到刚导入的数据集，名称后面的标签是机器人来源　② 点名称进入 Episode 列表，检查时长和标注状态') + '''

<h2 id="task">建任务</h2>
''' + stepfig('task-create-1', '第 6 步　填任务表单',
              '① 任务名称　② 关联数据集　③ 标注负责人　④ 审核负责人') + '''
''' + stepfig('task-create-2', '第 7 步　确认后创建',
              '四项都填好，在页面底部点「创建任务」') + '''
<table>
  <tr><th>字段</th><th>只能选</th></tr>
  <tr><td>标注负责人</td><td>标注员或管理员（选审核员会被拦下）</td></tr>
  <tr><td>审核负责人</td><td>审核员或管理员</td></tr>
</table>
<div class="note">要接着已有版本改，在「起始版本」里选对应版本；否则从原始数据开始。创建后任务自动跑完「预处理」，停在「人工标注」等人。</div>

<h2 id="handover">接手别人的任务</h2>
''' + stepfig('task-detail-1', '情况一　标注人不在',
              '直接点「进入工作区」替他把标注做完，再点「完成人工标注」') + '''
''' + stepfig('review-1', '情况二　审核人不在',
              '任务进入「人工验收」后，管理员也能点「质检通过」或「打回重标」') + '''
<table>
  <tr><th>情况</th><th>做法</th></tr>
  <tr><td>程序质检不通过、任务失败</td><td>任务详情页点「返回标注修正」（或「转回节点」），补完再提交</td></tr>
  <tr><td>流程节点配错了</td><td>「编辑流程」调整后续节点；必要时「强制流转」，需填写原因，会记入执行事件</td></tr>
  <tr><td>任务不用了</td><td>「取消任务」，工作区副本随之作废，原始数据不受影响</td></tr>
</table>

<h2 id="result">查看与发布结果</h2>
''' + stepfig('release-1', '完成后',
              '任务状态变成「已完成」，五个节点全部通过') + '''
''' + stepfig('versions-1', '在「版本管理」找产物',
              '① ② 每次发布都是独立版本，有校验摘要和完整数据包，旧版本不会被覆盖') + '''
<p>要自己标一遍的完整操作（划片段、写描述、SAM 生成目标框、保存）见<a href="role-annotator.html">标注员</a>页。</p>
''')

# ── 按角色：标注员 ──
PAGES['role-annotator.html'] = dict(
    title='标注员',
    crumbs=[('概览', 'index.html')],
    toc=[('能做什么', 'can'), ('进入工作区', 'enter'), ('划片段', 'segments'),
         ('写描述', 'describe'), ('标注目标框（SAM）', 'sam'), ('手动补画（兜底）', 'bbox'), ('保存与提交', 'submit'),
         ('提交前检查', 'checklist')],
    body='''
<h1>标注员</h1>
<p class="lead">标注员只做一件事：把分配给自己的任务标完、保存、提交。看不到别人的任务，也不用管数据集和账号。</p>

<h2 id="can">能做什么</h2>
<table>
  <tr><th>能做</th><th>不能做</th></tr>
  <tr><td>打开分配给自己的任务、进入工作区标注</td><td>新建任务、分配负责人</td></tr>
  <tr><td>划片段、写描述、用 SAM 点选生成目标框并传播跟踪</td><td>审核通过、打回、发布版本</td></tr>
  <tr><td>单条 Episode 点「通过」「数据不可用，跳过标注」并填原因</td><td>修改数据集、管理账号、编辑流程</td></tr>
  <tr><td>保存工作区、提交审核、被退回后修改重提</td><td>改别人负责的任务</td></tr>
</table>

<h2 id="enter">进入工作区</h2>
''' + stepfig('login-1', '第 1 步　登录', '用管理员给你的账号登录，第一次登录要先改密码') + '''
<p>登录后在「任务管理」里找分配给自己的任务，点进任务详情。</p>
''' + stepfig('task-detail-1', '第 2 步　进入工作区', '在「人工标注」节点点「进入工作区」') + '''
''' + stepfig('studio-1', '第 3 步　开始标注', '点「开始标注」，再点左侧「编辑」，下方片段轨道才能改') + '''
''' + stepfig('studio-2', '认识界面',
              '① Episode 列表　② 相机画面　③ 曲线与原始数据　④ 时间轴 / 片段轨道　⑤ 标注面板') + '''

<h2 id="segments">划片段</h2>
''' + stepfig('segment-1', '第 4 步　新建片段', '在轨道斜纹区点一下，弹出「子任务」对话框') + '''
''' + stepfig('segment-2', '第 5 步　给片段起名字', '① 输入片段名，例如「抓取食物」　② 点「保存」') + '''
''' + stepfig('segment-3', '第 6 步　拖边界对齐动作',
              '鼠标移到片段边缘出现把手，左右拖动调整起止帧；剩下的斜纹区再点一下，给下一段命名') + '''
<div class="note warn"><b>注意：</b>界面底部提示的 <kbd>Q</kbd> / <kbd>R</kbd> / <kbd>Enter</kbd> 快捷键在当前版本没生效，用鼠标点轨道和拖拽边界即可。</div>

<h2 id="describe">写描述</h2>
''' + stepfig('describe-1', '第 7 步　填结构化描述',
              '① 点轨道上的片段选中　② 技能　③ 对象　④ 目标；可下拉选择，也可输入新词后回车') + '''
''' + stepfig('describe-2', '第 8 步　描述自动成句', '四个字段合成一句描述，显示在面板「当前 Subtask 片段」下方') + '''

<h2 id="sam">标注目标框（SAM，主要方式）</h2>
<p>目标框主要靠 SAM 生成：在画面上点一下目标，SAM 分割出轮廓，再沿整段视频逐帧跟踪，一次就能得到整个片段的框。手动画框只用来兜底（SAM 服务不可用，或个别帧需要修正时）。</p>
''' + stepfig('sam-1', '第 9 步　打开 SAM', '选中片段后，面板底部点「SAM 点选分割」；没选片段时这个入口不出现') + '''
''' + stepfig('sam-2', '第 10 步　选相机并点选', '① 选择要分割的相机　② 等面板显示「SAM 就绪」后，在画面上点一下目标') + '''
''' + stepfig('sam-3', '第 11 步　确认轮廓并传播',
              '出现蓝色轮廓和绿色圆点后点「传播跟踪」，按钮上显示进度，跑完提示「已生成目标框：N 帧轨迹」') + '''
<p>点错了可以继续加点修正：再点目标内部补正点，按住 <kbd>Shift</kbd> 点背景作为负点。确认无误后按 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> 或点右上角「保存」，轮廓在后台落盘。</p>
<div class="note">什么时候用手动画框：① SAM 服务没部署或加载失败；② 传播后个别帧框偏了，直接拖那个框修正；③ 目标太小、点不准。其余情况优先用 SAM，比手画快很多，也不会漏掉跟踪帧。</div>
<div class="note tip"><b>建议：</b>只标关键物体（例如被拿取的那一个碗），比把所有物体都标上更省时间，程序质检也更容易通过。</div>
<div class="note warn"><b>返回的框特别大：</b>没点中目标（把桌面、墙面当成了目标）。点「放弃对象」换个位置再点，或换到视野更完整的相机重试。</div>

<h2 id="bbox">手动补画目标框（兜底）</h2>
<p>SAM 服务不可用、目标太小点不准，或者传播后个别帧框偏了，才需要手动处理。</p>
''' + stepfig('bbox-1', '第 12 步　手动画框或修正',
              '在相机画面按住拖动即可画框，画好的框出现在右侧「目标框」列表里；已有框可以直接拖动调整') + '''

<h2 id="submit">保存与提交</h2>
<p>工作台有两个「保存」：面板右上角的「保存」只存当前 Episode，「保存修改」会先存当前 Episode，再把整个工作区写回任务版本。</p>
''' + stepfig('save-1', '第 13 步　看顶部保存状态', '① 「保存修改」　② 状态显示「未保存」，说明还有改动没写回') + '''
''' + stepfig('save-2', '第 14 步　保存修改并等「已保存」', '① 点「保存修改」　② 状态变成「已保存」才算写回任务版本') + '''
''' + stepfig('save-3', '随时　单独保存这一条', '面板右上角的「保存」只存当前 Episode，没有改动时按钮是灰的') + '''
<div class="note">面板「保存」没点也不会丢：「保存修改」会先替你存当前这条。但没保存就换 Episode、切数据集会被拦住，并提示「请先保存上一片段的标注」。只有关掉浏览器标签页才会弹「离开此网站？」。</div>
''' + stepfig('review-3', '第 15 步　提交审核', '回到任务详情页，在「人工标注」节点点「完成人工标注」') + '''
<p>审核打回时任务退回「人工标注」，按打回原因改完点「修改后重新提交」。有未写回的改动时，「完成人工标注」是灰的。</p>

<h2 id="checklist">提交前检查</h2>
<table>
  <tr><th>检查项</th><th>怎么确认</th></tr>
  <tr><td>每条 Episode 都标了，或填了跳过原因</td><td>看左侧 Episode 列表的状态标记；没标的会让程序质检失败</td></tr>
  <tr><td>片段边界对得上动作</td><td>播放一遍，确认起止帧</td></tr>
  <tr><td>描述和目标框都有</td><td>逐个片段选中，检查右侧面板</td></tr>
  <tr><td>顶部显示「已保存」</td><td>没保存时「完成人工标注」是灰的</td></tr>
</table>
''')

# ── 按角色：审核员 ──
PAGES['role-reviewer.html'] = dict(
    title='审核员',
    crumbs=[('概览', 'index.html')],
    toc=[('能做什么', 'can'), ('建任务', 'create'), ('验收流程', 'flow'),
         ('质检管理', 'qc'), ('打回原因怎么写', 'reject'), ('发布结果', 'result')],
    body='''
<h1>审核员</h1>
<p class="lead">审核员有两种活：给标注员建任务，以及验收标注结果。工作台对审核员是只读的，你只能看和判定，不能改标注。</p>

<h2 id="can">能做什么</h2>
<table>
  <tr><th>能做</th><th>不能做</th></tr>
  <tr><td>新建任务、指定标注负责人和审核负责人</td><td>修改标注（工作台只读）</td></tr>
  <tr><td>「查看视频质检」进入只读工作区逐条看</td><td>管理账号、删除数据集</td></tr>
  <tr><td>对分配给自己的任务点「质检通过」或「打回重标」</td><td>替别人做审核确认</td></tr>
  <tr><td>质检管理里跑扫描、跳到问题帧；编辑流程；返回标注修正</td><td>发布或取消版本</td></tr>
</table>

<h2 id="create">建任务</h2>
''' + stepfig('task-create-1', '第 1 步　填任务表单',
              '① 任务名称　② 关联数据集　③ 标注负责人（必须选标注员或管理员）　④ 审核负责人（选自己或别的审核员）') + '''
''' + stepfig('task-create-2', '第 2 步　确认后创建', '四项都填好，在页面底部点「创建任务」') + '''
<p>创建后任务自动跑完「预处理」，停在「人工标注」，等标注员开工。</p>

<h2 id="flow">验收流程</h2>
''' + stepfig('reviewer-2', '第 3 步　等提交',
              '标注员没提交前，任务停在「人工标注」，页面提示由指定负责人检查并确认') + '''
''' + stepfig('review-1', '第 4 步　找验收按钮',
              '任务进入「人工验收」后：① 查看视频质检　② 质检通过　③ 打回重标') + '''
''' + stepfig('review-2', '第 5 步　逐条检查',
              '进入只读工作台，播放视频核对片段边界、描述、目标框；只能看不能改') + '''
''' + stepfig('review-3', '第 6 步　通过',
              '确认无误点「质检通过」，系统随后自动跑程序质检并发布新版本') + '''

<h2 id="qc">质检管理</h2>
<p>不用等提交，也可以主动对某个数据集跑一遍程序质检，它会列出有问题的帧。</p>
''' + stepfig('reviewer-1', '随时可用', '选数据集，点右上角「扫描」；结果按 Episode 分组，点一下跳到问题帧') + '''

<h2 id="reject">打回原因怎么写</h2>
<p>打回必须填写原因，这段话会直接显示在标注员的任务里。写得越具体，来回越少：</p>
<table>
  <tr><th>不好的写法</th><th>好的写法</th></tr>
  <tr><td>不对，重标</td><td>Episode 1 第 6.0–9.5 秒的片段边界提前了，抓到碗之后再开始</td></tr>
  <tr><td>框偏了</td><td>Episode 0「抓取食物」的目标框框到了两个碗，只标被拿的那个</td></tr>
  <tr><td>描述有问题</td><td>Episode 2 的目标应填「托盘」，现在填的是「桌子」</td></tr>
</table>
<div class="note">某条 Episode 确实没法用时，让标注员用「数据不可用，跳过标注」并填写原因；没填原因跳过，程序质检不通过。</div>

<h2 id="result">发布结果</h2>
''' + stepfig('release-1', '验收完成后', '任务状态变成「已完成」，五个节点全部通过') + '''
''' + stepfig('versions-1', '在「版本管理」确认产物',
              '① ② 每次发布都是独立版本，有校验摘要和完整数据包，旧版本不会被覆盖') + '''
''')
