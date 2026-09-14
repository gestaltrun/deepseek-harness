/** Compare the complete public declaration closure in independent strict TypeScript programs. */
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
import ts from 'typescript'

function withinPublicTypes(file, packageRoot) {
  const path = relative(resolve(packageRoot, 'lib/types'), resolve(file))
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)
}

/**
 * Prove exported names and resolved declaration syntax agree without loading nominal copies together.
 * @param {string} root - Private cache containing the generated ambient declaration and npm dependency link.
 * @param {string} packageRoot - Actual installed protocol package directory.
 * @returns {{exports: number, declarations: number}} Compared public export and declaration counts.
 */
export function assertProtocolEquivalent(root, packageRoot) {
const entry=join(root,'public-consumer.ts')
writeFileSync(entry,"import type * as Public from '@deepseek-ai/dsh-typert-protocol';\nexport type PublicModule = typeof Public;\n")
const common={target:ts.ScriptTarget.ES2024,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,skipLibCheck:false,noEmit:true,types:['node']}
function build(mapped){
  const options={...common,...mapped?{paths:{'@deepseek-ai/dsh-typert-protocol':[join(root,'protocol.ambient.d.ts')]}}:{}}
  const program=ts.createProgram([entry,...mapped?[join(root,'protocol.ambient.d.ts')]:[]],options)
  const diagnostics=ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:x=>x,getNewLine:()=> '\n'}))
  const checker=program.getTypeChecker()
  const source=program.getSourceFile(entry)
  const imported=source.statements[0].importClause.namedBindings.name
  const symbol=checker.getAliasedSymbol(checker.getSymbolAtLocation(imported))
  return {program,checker,exports:checker.getExportsOfModule(symbol).map(x=>x.name).sort()}
}
const original=build(false),ambient=build(true)
assert.deepEqual(original.exports,ambient.exports)
const printer=ts.createPrinter({removeComments:true})
function canonical(node,checker){
  const result=ts.transform(node,[context=>{
    const visit=node=>{
      if(ts.isStringLiteral(node))return ts.factory.createStringLiteral(node.text)
      if(ts.isParenthesizedTypeNode(node))return ts.visitNode(node.type,visit)
      if(ts.isImportTypeNode(node)&&node.qualifier&&!node.isTypeOf){
        const symbol=checker.getSymbolAtLocation(node.qualifier)
        if(symbol?.declarations?.some(declaration=>withinPublicTypes(declaration.getSourceFile().fileName, packageRoot))){
          return ts.factory.createTypeReferenceNode(symbol.name,node.typeArguments?.map(argument=>ts.visitNode(argument,visit)))
        }
      }
      let current=ts.visitEachChild(node,visit,context)
      if(ts.canHaveModifiers(current))current=ts.factory.replaceModifiers(current,ts.getModifiers(current)?.filter(mod=>mod.kind!==ts.SyntaxKind.ExportKeyword&&mod.kind!==ts.SyntaxKind.DeclareKeyword))
      return current
    }
    return visit
  }])
  try{return printer.printNode(ts.EmitHint.Unspecified,result.transformed[0],node.getSourceFile())}
  finally{result.dispose()}
}
function declarations(statements,checker){
  return statements.flatMap(node=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)||ts.isExportAssignment(node))return []
    if(ts.isVariableStatement(node))return node.declarationList.declarations.map(declaration=>canonical(declaration,checker))
    return [canonical(node,checker)]
  }).sort()
}
const originalStatements=original.program.getSourceFiles().filter(file=>withinPublicTypes(file.fileName, packageRoot)).flatMap(file=>[...file.statements])
const ambientFile=ambient.program.getSourceFile(join(root,'protocol.ambient.d.ts'))
const outer=ambientFile.statements.find(node=>ts.isModuleDeclaration(node)&&node.name.text==='@deepseek-ai/dsh-typert-protocol')
const originalDeclarations=declarations(originalStatements,original.checker)
const ambientDeclarations=declarations([...outer.body.statements],ambient.checker)
writeFileSync(join(root,'original-canonical.json'),JSON.stringify(originalDeclarations,null,2)+'\n')
writeFileSync(join(root,'ambient-canonical.json'),JSON.stringify(ambientDeclarations,null,2)+'\n')
assert.deepEqual(ambientDeclarations,originalDeclarations)
return { exports: original.exports.length, declarations: originalDeclarations.length }

}
