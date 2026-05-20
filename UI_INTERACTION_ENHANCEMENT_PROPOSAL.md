# UI 交互业务逻辑识别增强方案

## 问题定义

当前 Understand Anything 对后端业务逻辑识别能力强（API、数据库、服务调用），但对前端 UI 交互逻辑识别较弱，影响产品经理对客户端业务流程的理解。

## 核心缺失能力

### 1. JSX/TSX 事件处理器识别 ❌
```tsx
// 当前无法识别这些业务入口点
<button onClick={handleLogin}>登录</button>
<input onChange={e => setEmail(e.target.value)} />
<form onSubmit={handleSubmit}>
```

### 2. Vue 模板事件绑定识别 ❌
```vue
<!-- 当前无法识别 -->
<button @click="handleLogin">登录</button>
<input v-model="email" @input="validateEmail" />
```

### 3. 条件渲染业务规则识别 ❌
```tsx
// 当前无法提取这些业务规则
{isVIP && <VIPBadge />}
{!hasPermission && <PaywallModal />}
{orderStatus === 'pending' && <CancelButton />}
```

### 4. 表单校验规则识别 ❌
```typescript
// 当前无法自动提取验证逻辑
const schema = z.object({
  email: z.string().email(),
  age: z.number().min(18)
})
```

---

## 增强方案

### 方案 A：扩展 extract-domain-context.py 的正则模式

**适用场景：** 简单的事件处理器识别

**实现：**
```python
# 在 ENTRY_POINT_PATTERNS 中添加：

# React 事件处理器
("event", "React onClick handler", re.compile(
    r"""onClick\s*=\s*\{(\w+)\}"""
)),
("event", "React onSubmit handler", re.compile(
    r"""onSubmit\s*=\s*\{(\w+)\}"""
)),
("event", "React onChange handler", re.compile(
    r"""onChange\s*=\s*\{(\w+)\}"""
)),

# Vue 事件指令
("event", "Vue @click handler", re.compile(
    r"""@click\s*=\s*["'](\w+)["']"""
)),
("event", "Vue @submit handler", re.compile(
    r"""@submit\s*=\s*["'](\w+)["']"""
)),
```

**局限性：**
- ⚠️ 只能识别简单的事件处理器引用
- ❌ 无法识别内联箭头函数：`onClick={() => doSomething()}`
- ❌ 无法识别解构的处理器：`onClick={handlers.submit}`

**优先级：** 🔥 **高** (快速见效)

---

### 方案 B：使用 Babel/TypeScript AST 解析 JSX

**适用场景：** 完整的 React/Vue 事件处理器识别

**实现：**

#### 步骤 1：添加 JSX 属性提取器

在 `extract-structure.mjs` 中添加 JSX 特定的访问器：

```javascript
// extract-structure.mjs
import traverse from '@babel/traverse'
import { parse } from '@babel/parser'

function extractJSXInteractions(filePath, content) {
  const ast = parse(content, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  })
  
  const interactions = []
  
  traverse(ast, {
    JSXAttribute(path) {
      const name = path.node.name.name
      
      // 匹配所有事件属性
      if (name.startsWith('on')) {
        const eventType = name.substring(2).toLowerCase() // onClick → click
        const handler = extractHandlerName(path.node.value)
        
        interactions.push({
          type: 'ui-event',
          eventType,
          handler,
          lineNumber: path.node.loc.start.line
        })
      }
    }
  })
  
  return interactions
}

function extractHandlerName(valueNode) {
  // onClick={handleSubmit}
  if (valueNode.expression?.type === 'Identifier') {
    return valueNode.expression.name
  }
  
  // onClick={() => doSomething()}
  if (valueNode.expression?.type === 'ArrowFunctionExpression') {
    return '<inline-arrow-function>'
  }
  
  // onClick={handlers.submit}
  if (valueNode.expression?.type === 'MemberExpression') {
    return extractMemberExpression(valueNode.expression)
  }
  
  return '<unknown>'
}
```

#### 步骤 2：在 file-analyzer.md 中处理 UI 事件

```markdown
## Step X — Create UI Event Nodes

For each detected UI event interaction, create edges:

**UI Event Edge Pattern:**
- **Source:** Component node (file or class)
- **Target:** Handler function node
- **Edge type:** `ui_interaction`
- **Description:** `"<eventType> event triggers <handlerName>"`
- **Weight:** 0.8
- **Metadata:** `{ eventType: 'click', uiElement: 'button' }`

Example:
```json
{
  "source": "class:src/components/LoginForm.tsx:LoginForm",
  "target": "function:src/components/LoginForm.tsx:handleSubmit",
  "type": "calls",
  "description": "click event on submit button triggers form submission",
  "direction": "forward",
  "weight": 0.8
}
```
```

**优先级：** 🔥🔥 **最高** (全面解决)

**工作量：** 中等 (2-3 天开发 + 测试)

---

### 方案 C：增加 domain-analyzer 对 UI 流程的理解

**适用场景：** 让 LLM 从现有代码中推理出 UI 交互流程

**实现：**

#### 修改 domain-analyzer.md 提示词

```markdown
## UI Interaction Flow Analysis

When analyzing frontend codebases, pay special attention to:

### User Interaction Entry Points

1. **Event Handlers** — Functions matching these patterns are likely user-triggered:
   - `handle*` (e.g., handleClick, handleSubmit)
   - `on*` (e.g., onClick, onFormSubmit)  
   - Functions passed to JSX event attributes

2. **Form Submissions** — Look for:
   - Form components with onSubmit handlers
   - API calls inside form handlers
   - Validation logic before submission

3. **Navigation Triggers** — Functions that call:
   - `navigate()`, `router.push()`, `history.push()`
   - `<Link to="...">` components

### Creating UI Flow Nodes

For each identified user interaction flow, create:

**Flow node example:**
```json
{
  "id": "flow:user-login-interaction",
  "type": "flow",
  "name": "User Login Interaction",
  "summary": "User enters credentials, clicks login button, system validates and redirects to dashboard",
  "domainMeta": {
    "entryPoint": "LoginForm onClick event",
    "entryType": "ui-event"  // ← 新增类型
  }
}
```

**Step nodes example:**
```json
{
  "id": "step:user-login-interaction:validate-form",
  "type": "step",
  "name": "Validate Form Input",
  "summary": "Check email format and password length before API call",
  "filePath": "src/components/LoginForm.tsx",
  "lineRange": [45, 52]
},
{
  "id": "step:user-login-interaction:call-api",
  "type": "step",
  "name": "Call Login API",
  "summary": "POST /api/auth/login with credentials",
  "filePath": "src/services/auth.ts",
  "lineRange": [10, 25]
},
{
  "id": "step:user-login-interaction:handle-success",
  "type": "step",
  "name": "Navigate to Dashboard",
  "summary": "Store auth token and redirect to /dashboard",
  "filePath": "src/components/LoginForm.tsx",
  "lineRange": [60, 65]
}
```
```

**优先级：** 🔥 **高** (可以立即改进)

**工作量：** 低 (1 天修改提示词 + 测试)

---

### 方案 D：添加表单业务规则提取

**适用场景：** 自动提取 Zod/Yup/Joi 等验证库的规则

**实现：**

```javascript
// extract-structure.mjs
function extractValidationRules(ast) {
  const rules = []
  
  traverse(ast, {
    CallExpression(path) {
      // 匹配 z.object({ email: z.string().email() })
      if (isZodSchema(path.node)) {
        rules.push({
          type: 'validation',
          library: 'zod',
          rules: extractZodRules(path.node)
        })
      }
      
      // 匹配 Yup.object().shape({ ... })
      if (isYupSchema(path.node)) {
        rules.push({
          type: 'validation',
          library: 'yup',
          rules: extractYupRules(path.node)
        })
      }
    }
  })
  
  return rules
}

function extractZodRules(node) {
  // 解析 z.string().email().min(5) → { type: 'string', validators: ['email', 'min(5)'] }
  // ...
}
```

**在知识图谱中表示：**

```json
{
  "id": "schema:src/validation/registerSchema.ts:RegisterSchema",
  "type": "schema",
  "name": "RegisterSchema",
  "summary": "用户注册表单验证规则：email 必须合法，密码至少 8 位包含大小写",
  "tags": ["validation", "form", "user-registration"],
  "domainMeta": {
    "businessRules": [
      "Email must be valid format",
      "Password must be at least 8 characters",
      "Password must contain uppercase and lowercase",
      "Age must be 18 or older"
    ]
  }
}
```

**优先级：** 🔥 **中高** (对业务理解帮助大)

**工作量：** 中等 (3-4 天支持主流验证库)

---

## 实现路线图

### Phase 1: 快速改进 (1 周)

✅ **Week 1:**
1. 扩展 `extract-domain-context.py` 正则模式 (方案 A)
2. 修改 `domain-analyzer.md` 提示词 (方案 C)
3. 在 Dashboard 中添加 "UI Interaction" 过滤器

**交付成果：**
- 可以识别简单的 `onClick={handler}` 模式
- LLM 能推理出基本的 UI 交互流程

---

### Phase 2: 核心增强 (2-3 周)

✅ **Week 2-3:**
1. 实现 Babel AST 解析 JSX 属性 (方案 B)
2. 扩展 `extract-structure.mjs` 支持 Vue SFC 解析
3. 在 file-analyzer 中处理 UI 事件边

**交付成果：**
- 完整识别所有 React/Vue 事件处理器
- 知识图谱中包含 `ui_interaction` 边类型

---

### Phase 3: 高级功能 (1-2 周)

✅ **Week 4-5:**
1. 表单验证规则提取 (方案 D)
2. 条件渲染业务规则识别
3. useEffect 副作用逻辑识别

**交付成果：**
- 自动提取表单业务规则
- 识别会员/权限等条件显示逻辑

---

## 预期效果

### 改进前 ❌

**PM 提问：** "点击登录按钮会发生什么？"

**系统回答：** "抱歉，知识图谱中没有找到与'登录按钮'相关的信息。"

---

### 改进后 ✅

**PM 提问：** "点击登录按钮会发生什么？"

**系统回答：**
```
登录按钮的完整交互流程：

1. 触发 LoginForm.handleSubmit 函数 (src/components/LoginForm.tsx:45)
2. 验证表单输入：
   - Email 必须符合邮箱格式
   - 密码至少 8 位字符
3. 调用 API: POST /api/auth/login (src/services/auth.ts:10)
4. 成功后：
   - 保存认证 Token 到 localStorage
   - 跳转到 /dashboard 页面
5. 失败时：
   - 显示错误提示 Toast
   - 表单保持当前状态

涉及的组件：
- LoginForm (UI 层)
- authService (Service 层)  
- AuthContext (状态管理)
- DashboardPage (目标页面)
```

---

## 技术风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Babel 解析性能 | 中 | 只对有 JSX 的文件启用 |
| Vue SFC 解析复杂 | 高 | 使用 vue-template-compiler |
| 内联函数难以追踪 | 中 | 标记为 `<inline>` 并提取函数体 |
| 动态路径识别不准 | 低 | 保留字面量路径，动态路径标记 |

---

## 成功指标

1. **覆盖率：** 识别 90%+ 的显式事件处理器
2. **准确率：** 事件处理器到函数的映射准确率 > 95%
3. **用户满意度：** PM 对 UI 流程问答的满意度提升 50%+
4. **性能：** 单文件分析时间增加 < 30%

---

## 总结

通过实现上述方案，Understand Anything 将具备：

✅ **完整的前端事件识别能力**
✅ **UI 交互流程自动提取**
✅ **表单业务规则可视化**
✅ **用户行为路径追踪**

这将使产品经理能够像理解后端 API 一样理解前端业务逻辑。
