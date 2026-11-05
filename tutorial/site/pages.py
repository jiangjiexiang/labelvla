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

<h2>完整流程</h2>
<p>「流程演示」先看一遍整体流程；「操作指南」六页按顺序做一次标注；「参考」按需查阅。</p>
<div class="cards">
  <a class="card" href="demo.html"><b>流程演示</b><span>33 秒连续录屏，先看一遍整体流程</span></a>
  <a class="card" href="guide-login.html"><b>1. 登录与数据管理</b><span>登录、查看数据集和标注状态</span></a>
  <a class="card" href="guide-task.html"><b>2. 新建标注任务</b><span>选数据集、分配标注人和审核人</span></a>
  <a class="card" href="guide-studio.html"><b>3. 标注工作台</b><span>划片段、写描述、画目标框</span></a>
  <a class="card" href="guide-sam.html"><b>4. SAM 辅助分割</b><span>点一下目标，自动跟踪整段视频</span></a>
  <a class="card" href="guide-submit.html"><b>5. 保存与提交</b><span>把标注写回版本并交给审核</span></a>
  <a class="card" href="guide-release.html"><b>6. 审核与版本发布</b><span>视频质检、程序质检、发布新版本</span></a>
  <a class="card" href="faq.html"><b>常见问题</b><span>报错提示与处理办法</span></a>
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
PAGES['guide-login.html'] = dict(
    title='1. 登录与数据管理',
    crumbs=[('概览', 'index.html')],
    toc=[('登录', 'login'), ('查看数据集', 'datasets')],
    body='''
<h1>1. 登录与数据管理</h1>
<p class="lead">管理员账号 <code>admin</code>，密码 <code>admin123</code>（新部署未改过密码时为 <code>admin</code>，首次登录会要求改密）。</p>

<h2 id="login">登录</h2>
''' + stepfig('login-1', '第 1 步　输入账号和密码',
              '① 用户名　② 密码　③ 点「登录」；首次登录会先让你设置新密码。') + '''

<h2 id="datasets">查看数据集</h2>
<p>登录后默认进入「数据管理」，这里列出全部数据集。</p>
''' + stepfig('datasets-1', '第 2 步　找到要标注的数据集',
              '① 在列表里找到数据集，名称后面的标签是机器人来源　② 点名称进入 Episode 列表。') + '''
<p>点进去之后每条 Episode 显示时长、任务描述和标注状态（未标注 / 标注中 / 待审核 / 已通过 / 已打回）。数据看板可以看全局的标注进度和质检通过率。</p>
''')

# ── 2. 新建任务 ──
PAGES['guide-task.html'] = dict(
    title='2. 新建标注任务',
    crumbs=[('概览', 'index.html')],
    toc=[('填写表单', 'create'), ('进入任务', 'enter')],
    body='''
<h1>2. 新建标注任务</h1>
<p class="lead">左侧「任务管理 → 新建任务」。任务必须绑定一个真实数据集，创建时会在 <code>output/</code> 下自动建一份独立副本，标注只写副本。</p>

<h2 id="create">填写表单</h2>
''' + stepfig('task-create-1', '第 1 步　填四个必填项',
              '① 任务名称　② 关联数据集　③ 标注负责人　④ 审核负责人') + '''
''' + stepfig('task-create-2', '第 2 步　确认选择',
              '数据集、标注人、审核人都有值后，在页面底部点「创建任务」。') + '''
<div class="note">要接着已有版本改，在「起始版本」里选对应版本；否则从原始数据开始。</div>

<h2 id="enter">进入任务</h2>
<p>创建后任务自动跑完「预处理」，停在「人工标注」节点等人。</p>
''' + stepfig('task-detail-1', '第 3 步　从任务详情进入工作区',
              '在「人工标注」节点上点「进入工作区」；后续提交也在这一行完成。') + '''
''')

# ── 3. 工作台 ──
PAGES['guide-studio.html'] = dict(
    title='3. 标注工作台',
    crumbs=[('概览', 'index.html')],
    toc=[('进入工作区', 'enter'), ('界面分区', 'layout'), ('划片段', 'segments'), ('描述与目标框', 'describe')],
    body='''
<h1>3. 标注工作台</h1>
<p class="lead">划分动作片段、写描述、画目标框都在工作台里完成。下面按操作顺序给出每一屏。</p>

<h2 id="enter">进入工作区</h2>
''' + stepfig('studio-1', '第 1 步　点「开始标注」（或「编辑」）',
              '「开始标注」后 Episode 变成「标注中」；再点左侧「编辑」，下方片段轨道才能改。') + '''

<h2 id="layout">界面分区</h2>
''' + stepfig('studio-2', '认识界面',
              '① Episode 列表　② 相机画面　③ 曲线与原始数据　④ 时间轴 / 片段轨道　⑤ 标注面板') + '''

<h2 id="segments">划分动作片段</h2>
''' + stepfig('segment-1', '第 2 步　点未标注区新建片段',
              '在轨道斜纹区点一下，会弹出「子任务」对话框。') + '''
''' + stepfig('segment-2', '第 3 步　给片段起名字',
              '① 输入片段名，例如「抓取食物」　② 点「保存」。') + '''
''' + stepfig('segment-3', '第 4 步　拖边界对齐动作',
              '鼠标移到片段边缘出现把手，左右拖动调整起止帧；剩下的斜纹区再点一下，给下一段命名。') + '''
<div class="note warn"><b>注意：</b>界面底部提示的 <kbd>Q</kbd> / <kbd>R</kbd> / <kbd>Enter</kbd> 快捷键在当前版本没生效，用鼠标点轨道和拖拽边界即可。</div>

<h2 id="describe">写描述与画目标框</h2>
''' + stepfig('describe-1', '第 5 步　选中片段，填结构化描述',
              '① 点轨道上的片段选中　② 技能　③ 对象　④ 目标，可下拉选择也可输入新词后回车。') + '''
''' + stepfig('describe-2', '填完后自动成句',
              '四个字段会合成一句描述，显示在面板「当前 Subtask 片段」下方。') + '''
''' + stepfig('bbox-1', '第 6 步　在相机画面画目标框',
              '在任一相机画面按住拖动即可画框，画好的框会出现在右侧「目标框」列表里。') + '''
<div class="note tip"><b>建议：</b>只标关键物体（例如被拿取的那一个碗），比把所有物体都标上更省时间。</div>
''')

# ── 4. SAM ──
PAGES['guide-sam.html'] = dict(
    title='4. SAM 辅助分割',
    crumbs=[('概览', 'index.html')],
    toc=[('操作步骤', 'steps'), ('注意事项', 'caveat')],
    body='''
<h1>4. SAM 辅助分割</h1>
<p class="lead">点一下目标就能分割出轮廓，并沿整段视频逐帧跟踪，省去手工画每一帧。需要独立部署的推理服务。</p>

<h2 id="steps">操作步骤</h2>
''' + stepfig('sam-1', '第 1 步　选中片段后打开 SAM',
              '先在轨道上选中一个片段，面板底部才会出现「SAM 点选分割」。') + '''
''' + stepfig('sam-2', '第 2 步　选相机、点选目标',
              '① 选择要分割的相机　② 等面板显示「SAM 就绪」后，在画面上点一下目标。') + '''
''' + stepfig('sam-3', '第 3 步　确认轮廓并传播',
              '点中后出现蓝色轮廓和绿色圆点；确认无误后点「传播跟踪」，进度跑完会提示「已生成目标框：N 帧轨迹」。') + '''
<div class="note">最后按 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> 或点右上角「保存」，轮廓会在后台落盘。</div>

<h2 id="caveat">注意事项</h2>
<div class="note warn"><b>返回的框特别大：</b>说明没点中目标（把桌面、墙面当成了目标）。点「放弃对象」换个位置再点，或换到视野更完整的相机重试。</div>
<p>腕部相机视野窄、遮挡多，通常不如正面相机点得准。点选那一帧已经出结果，其他帧要等传播跑完；中途提示「资源加载失败」是正常现象，关掉弹窗等进度走完即可。</p>
''')

# ── 5. 保存提交 ──
PAGES['guide-submit.html'] = dict(
    title='5. 保存与提交',
    crumbs=[('概览', 'index.html')],
    toc=[('该点哪个保存', 'which'), ('保存与提交', 'save'), ('文件位置', 'files')],
    body='''
<h1>5. 保存与提交</h1>
<p class="lead">工作台里有两个「保存」，作用不同。不用每标一条就点两次：「保存修改」会先把当前这条 Episode 存掉，再一次性把整个工作区写回任务版本。</p>

<h2 id="which">该点哪个保存</h2>
<table>
  <tr><th>按钮</th><th>位置</th><th>作用</th><th>要不要点</th></tr>
  <tr><td>保存</td><td>标注面板右上角</td><td>只保存当前 Episode 的片段和目标框</td><td>可点可不点；不点也不会丢，「保存修改」会先替你存</td></tr>
  <tr><td>保存修改</td><td>工作台顶部</td><td>先存当前 Episode，再生成任务版本（含裁剪后的视频和其他 Episode 的改动）</td><td>提交审核前必须点，要看到「已保存」</td></tr>
</table>
<div class="note">没点 Episode 的「保存」就去做别的，会被拦住并提示「请先保存上一片段的标注」「请先保存或处理未保存的标注」，换 Episode、切数据集都会这样；此时点「保存修改」或 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> 就行，改动不会丢。只有关掉浏览器标签页时，才会弹「离开此网站？」的提醒。</div>

<h2 id="save">保存与提交</h2>
''' + stepfig('save-1', '第 1 步　看顶部的保存状态',
              '① 「保存修改」把整个工作区写回版本　② 旁边的状态显示「未保存」，说明还有改动没写回') + '''
''' + stepfig('save-2', '第 2 步　点「保存修改」并等它变「已保存」',
              '① 点「保存修改」　② 状态从「未保存」变成「已保存」后，改动才真正写回任务版本') + '''
''' + stepfig('save-3', '第 3 步　需要时单独保存当前这条',
              '标注面板右上角的「保存」只保存当前 Episode，没有改动时按钮是灰色的') + '''
<p>保存完成后回到任务详情页，在「人工标注」节点点「完成人工标注」（或在工作区逐条「通过」），任务流转到「人工验收」。还有未写回的改动时，这个按钮是灰的，并提示「请先在工作区保存修改」。</p>

<h2 id="files">文件位置</h2>
<table>
  <tr><th>内容</th><th>位置</th></tr>
  <tr><td>标注结果</td><td>版本目录下的 <code>segments/episode_XXXXXX.json</code></td></tr>
  <tr><td>任务版本</td><td><code>output/数据集名/数据集名vN</code></td></tr>
  <tr><td>平台数据库</td><td><code>data/.platform/platform.db</code></td></tr>
</table>
''')


PAGES['guide-release.html'] = dict(
    title='6. 审核与版本发布',
    crumbs=[('概览', 'index.html')],
    toc=[('审核', 'review'), ('发布结果', 'result')],
    body='''
<h1>6. 审核与版本发布</h1>
<p class="lead">审核人打开同一个任务，看到的是只读副本；确认无误后点通过，系统自动完成程序质检和版本发布。</p>

<h2 id="review">审核</h2>
''' + stepfig('review-1', '第 1 步　审核人查看视频',
              '① 查看视频质检　② 质检通过　③ 打回重标（打回必须填原因）') + '''
''' + stepfig('review-2', '审核时工作台是只读的',
              '面板顶部只有「通过 / 打回」，片段和目标框只能看不能改。') + '''
''' + stepfig('review-3', '第 2 步　点「质检通过」',
              '确认视频没问题后点「质检通过」，系统随后自动执行程序质检并发布新版本。') + '''

<h2 id="result">发布结果</h2>
''' + stepfig('release-1', '发布完成',
              '① 任务状态变为「已完成」　② 五个节点全部通过。') + '''
''' + stepfig('versions-1', '在「版本管理」查看新版本',
              '① ② 每次发布都是一个独立版本，有校验摘要和完整数据包，旧版本不会被覆盖。') + '''
<div class="note">程序质检不通过时，任务停在「程序质检」；用「转回节点」退回「人工标注」，补完再提交，不用新建任务。</div>
''')

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
PAGES['roles.html'] = dict(
    title='角色与权限', crumbs=[('概览', 'index.html')], toc=[],
    body='''
<h1>角色与权限</h1>
<p>平台有三种角色，各自看得到的东西不一样。每个角色的具体操作在对应页面里：<a href="role-admin.html">管理员</a>、<a href="role-annotator.html">标注员</a>、<a href="role-reviewer.html">审核员</a>。</p>
<table>
  <tr><th>角色</th><th>日常做什么</th><th>界面上能碰到的</th><th>做不了的</th></tr>
  <tr><td>管理员</td><td>管账号、导数据、建任务、兜底处理</td><td>全部模块，可编辑也可验收任意任务</td><td>—</td></tr>
  <tr><td>标注员</td><td>标注分配给自己的任务</td><td>数据看板、数据管理（只读）、任务、工作台（可编辑）</td><td>新建任务、审核通过/打回、账号与数据集管理</td></tr>
  <tr><td>审核员</td><td>验收、建任务、编辑流程</td><td>任务、只读工作台、质检管理、版本管理</td><td>修改标注、账号管理、删除数据集</td></tr>
</table>
<h2>分配任务时的约束</h2>
<table>
  <tr><th>字段</th><th>只能选</th></tr>
  <tr><td>标注负责人</td><td>标注员或管理员（给审核员会被拦下）</td></tr>
  <tr><td>审核负责人</td><td>审核员或管理员</td></tr>
</table>
<p>同一个人可以既是标注负责人又是审核负责人，但生产环境建议分开，便于追溯责任。审核员点「质检通过 / 打回」只对自己负责的任务生效。</p>
''')


PAGES['role-admin.html'] = dict(
    title='管理员',
    crumbs=[('概览', 'index.html')],
    toc=[('能做什么', 'can'), ('日常操作', 'daily'), ('接手别人的任务', 'handover'), ('对应章节', 'chapters')],
    body='''
<h1>管理员</h1>
<p class="lead">管理员负责账号、数据集和任务调度，也可以直接打开任何任务做标注或审核。日常需要会的不多，但「谁用哪个账号」决定了流程能不能走完。</p>

<h2 id="can">能做什么</h2>
<table>
  <tr><th>模块</th><th>管理员能做的事</th><th>谁来用</th></tr>
  <tr><td>数据管理</td><td>查看全部数据集、重新扫描、移入回收站与恢复、改机器人标签</td><td>管理员</td></tr>
  <tr><td>用户管理</td><td>新建账号、改角色、停用/删除、绑定钉钉、查看登录记录<sup>①</sup></td><td>管理员</td></tr>
  <tr><td>任务管理</td><td>新建任务、取消、重试、编辑流程、转回节点、强制流转</td><td>管理员、审核员（部分）</td></tr>
  <tr><td>标注 / 审核</td><td>打开任意任务的工作区，可编辑也可验收</td><td>管理员</td></tr>
</table>
<p class="lead"><sup>①</sup> 界面目前能新建账号和改角色；改密码、重置密码走接口或数据库，文档里不展开。</p>

<h2 id="daily">日常操作</h2>
''' + stepfig('admin-1', '第 1 步　看进度',
              '数据看板显示数据集与标注总量、标注状态分布、质检通过率、近期趋势') + '''
''' + stepfig('admin-2', '第 2 步　管账号',
              '用户管理里新建账号、改角色；① 新建账号　② 修改角色') + '''
''' + stepfig('admin-3', '第 3 步　导入数据',
              '数据集放进 <code>data/</code> 后点右上角「重新扫描」；不需要的数据可以移到回收站') + '''
<p>把第 2 章的任务交给某个人时，注意：<b>标注负责人必须是标注员（或管理员）</b>，审核负责人只能从<b>管理员和审核员</b>里选。给标注员分配审核、或把审核负责人留给标注员，流程会走不通。</p>

<h2 id="handover">接手别人的任务</h2>
<table>
  <tr><th>情况</th><th>做法</th></tr>
  <tr><td>标注人请假，任务停在「人工标注」</td><td>管理员直接进工作区改，完成后点「完成人工标注」</td></tr>
  <tr><td>程序质检不通过、任务失败</td><td>任务详情页点「返回标注修正」（或「转回节点」），补完再提交</td></tr>
  <tr><td>流程节点配错了</td><td>「编辑流程」调整后续节点，需要时用「强制流转」并填原因，操作会记入执行事件</td></tr>
</table>

<h2 id="chapters">对应章节</h2>
<p>建任务看 <a href="guide-task.html">2. 新建标注任务</a>；需要时按 <a href="guide-studio.html">3~5 章</a> 自己标一遍；审核和发布看 <a href="guide-release.html">6. 审核与版本发布</a>。角色权限对照表在 <a href="roles.html">角色与权限</a>。</p>
''')

# ── 按角色：标注员 ──
PAGES['role-annotator.html'] = dict(
    title='标注员',
    crumbs=[('概览', 'index.html')],
    toc=[('能做什么', 'can'), ('每天的工作流', 'flow'), ('提交前检查', 'checklist')],
    body='''
<h1>标注员</h1>
<p class="lead">标注员只做一件事：把分配给自己的任务标完、保存、提交审核。看不到别人的任务，也不需要碰数据集和账号。</p>

<h2 id="can">能做什么</h2>
<table>
  <tr><th>能做</th><th>不能做</th></tr>
  <tr><td>打开分配给自己的任务、进入工作区标注</td><td>新建任务、分配负责人</td></tr>
  <tr><td>划片段、写描述、画目标框、用 SAM 辅助</td><td>审核通过、打回、发布版本</td></tr>
  <tr><td>单条 Episode 点「通过」「数据不可用，跳过标注」并填原因</td><td>修改数据集、管理账号、编辑流程</td></tr>
  <tr><td>保存工作区、提交审核、被退回后修改重提</td><td>改别人负责的任务</td></tr>
</table>

<h2 id="flow">每天的工作流</h2>
''' + stepfig('login-1', '第 1 步　登录', '用管理员给你的账号登录，第一次登录要先改密码') + '''
<p>登录后在「任务管理」里找分配给自己的任务，点进任务详情。</p>
''' + stepfig('task-detail-1', '第 2 步　进入工作区', '在「人工标注」节点点「进入工作区」') + '''
''' + stepfig('studio-1', '第 3 步　开始标注', '点「开始标注」，再点左侧「编辑」') + '''
''' + stepfig('segment-2', '第 4 步　划片段并命名', '斜纹区点一下新建片段，填名字后保存') + '''
''' + stepfig('describe-1', '第 5 步　写描述', '选中片段，填技能 / 对象 / 目标') + '''
''' + stepfig('bbox-1', '第 6 步　画目标框', '在相机画面拖动画框') + '''
''' + stepfig('save-2', '第 7 步　保存修改', '顶部「保存修改」，等状态变成「已保存」') + '''
''' + stepfig('review-3', '第 8 步　提交审核', '回到任务详情，点「完成人工标注」') + '''
<p>审核打回时，任务会退回到「人工标注」，按打回原因修改后用「修改后重新提交」再次提交。难标的物体可以用 <a href="guide-sam.html">SAM 辅助分割</a> 省时间。</p>

<h2 id="checklist">提交前检查</h2>
<table>
  <tr><th>检查项</th><th>怎么确认</th></tr>
  <tr><td>每条 Episode 都标了，或填了跳过原因</td><td>左侧 Episode 列表的状态标记；没标的会让程序质检失败</td></tr>
  <tr><td>片段边界对得上动作</td><td>播放一遍，确认起止帧</td></tr>
  <tr><td>描述和目标框都有</td><td>逐个片段选中检查右侧面板</td></tr>
  <tr><td>顶部显示「已保存」</td><td>没保存时「完成人工标注」是灰的</td></tr>
</table>
''')

# ── 按角色：审核员 ──
PAGES['role-reviewer.html'] = dict(
    title='审核员',
    crumbs=[('概览', 'index.html')],
    toc=[('能做什么', 'can'), ('审核流程', 'flow'), ('打回时要写什么', 'reject')],
    body='''
<h1>审核员</h1>
<p class="lead">审核员负责验收：看视频、检查片段和目标框，通过或打回。工作台对审核员是只读的，改不了标注。</p>

<h2 id="can">能做什么</h2>
<table>
  <tr><th>能做</th><th>不能做</th></tr>
  <tr><td>新建任务、指定标注负责人和审核负责人</td><td>修改标注（工作台只读）</td></tr>
  <tr><td>「查看视频质检」进入只读工作区逐条看</td><td>管理账号、删除数据集</td></tr>
  <tr><td>对分配给自己的任务点「质检通过」或「打回重标」</td><td>替别人做审核确认</td></tr>
  <tr><td>编辑流程、返回标注修正</td><td>—</td></tr>
</table>

<h2 id="flow">审核流程</h2>
''' + stepfig('reviewer-2', '第 1 步　等提交',
              '标注员没提交前，任务停在「人工标注」，页面会提示由指定负责人检查并确认') + '''
''' + stepfig('review-1', '第 2 步　找验收按钮',
              '任务进入「人工验收」后：① 查看视频质检　② 质检通过　③ 打回重标') + '''
''' + stepfig('review-2', '第 3 步　逐条检查',
              '进入只读工作台，播放视频核对片段边界、描述、目标框；只能看不能改') + '''
''' + stepfig('review-3', '第 4 步　通过',
              '确认无误点「质检通过」，系统随后自动跑程序质检并发布新版本') + '''
''' + stepfig('release-1', '第 5 步　看结果',
              '任务变成「已完成」，五个节点全部通过') + '''
<p>平时也可以用「质检管理」对某个数据集跑一遍程序质检，它会列出有问题的帧，点一下就能跳过去看。</p>
''' + stepfig('reviewer-1', '辅助：质检管理',
              '选数据集，点右上角「扫描」；结果按 Episode 分组，可跳到问题帧') + '''

<h2 id="reject">打回时要写什么</h2>
<p>打回必须填写原因，这段话会直接显示在标注员的任务里。写得越具体，来回越少：</p>
<table>
  <tr><th>不好的写法</th><th>好的写法</th></tr>
  <tr><td>不对，重标</td><td>Episode 1 第 6.0–9.5 秒的片段边界提前了，抓到碗之后再开始</td></tr>
  <tr><td>框偏了</td><td>Episode 0「抓取食物」的目标框框到了两个碗，只标被拿的那个</td></tr>
  <tr><td>描述有问题</td><td>Episode 2 的目标应填「托盘」，现在填的是「桌子」</td></tr>
</table>
<p>另外，如果某条 Episode 确实没法用，可以让标注员用「数据不可用，跳过标注」并填写原因，程序质检会采纳这个原因；没填原因跳过，程序质检不通过。</p>
''')

