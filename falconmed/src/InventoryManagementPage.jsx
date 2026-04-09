import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { extractUnits } from "./utils/packagingEngine";
import { getDrugByCode, searchDrugs } from "./utils/drugLookup";

export default function InventoryManagementPage() {

const [pharmacies,setPharmacies]=useState([])
const [inventory,setInventory]=useState([])
const [drugOptions,setDrugOptions]=useState([])
const [selectedPharmacyId,setSelectedPharmacyId]=useState("")

const [drug,setDrug]=useState("")
const [drugCode,setDrugCode]=useState("")
const [barcode,setBarcode]=useState("")
const [qty,setQty]=useState("")
const [cost,setCost]=useState("")
const [expiry,setExpiry]=useState("")
const [batch,setBatch]=useState("")

const [showDrugDropdown,setShowDrugDropdown]=useState(false)
const [loading,setLoading]=useState(true)
const [error,setError]=useState("")
const [success,setSuccess]=useState("")
const [drugCodeLookup,setDrugCodeLookup]=useState(null)
const [drugCodeResults,setDrugCodeResults]=useState([])
const [showDrugCodeDropdown,setShowDrugCodeDropdown]=useState(false)
const [drugCodeMessage,setDrugCodeMessage]=useState("")
const [debouncedDrugCode,setDebouncedDrugCode]=useState("")

const normalizedDrugQuery=useMemo(()=>drug.trim().toLowerCase(),[drug])
const normalizedDrugCodeQuery=useMemo(()=>drugCode.trim(),[drugCode])

const drugOptionsIndexed=useMemo(()=>drugOptions.map(name=>(
({
name,
searchKey:name.toLowerCase()
})
)),[drugOptions])

// load pharmacies
useEffect(()=>{
loadPharmacies()
loadInventory()
loadDrugs()
},[])

async function loadPharmacies(){

const {data,error}=await supabase
.from("pharmacies")
.select("*")

if(!error)setPharmacies(data||[])

}

async function loadInventory(){

const {data,error}=await supabase
.from("pharmacy_inventory")
.select("*")
.order("drug_name",{ascending:true})

if(!error)setInventory(data||[])
setLoading(false)

}

async function loadDrugs(){

let all=[]
let page=0

while(true){

const {data,error}=await supabase
.from("drug_master")
.select("drug_name")
.range(page,page+999)

if(error||!data?.length)break

all=[...all,...data]
page+=1000

if(data.length<1000)break

}

const names=[...new Set(all.map(d=>d.drug_name).filter(Boolean))]
setDrugOptions(names.sort())

}

const filteredDrugs=useMemo(()=>{

if(!normalizedDrugQuery)return drugOptions.slice(0,20)

return drugOptionsIndexed
.filter(d=>d.searchKey.includes(normalizedDrugQuery))
.slice(0,20)
.map(d=>d.name)

},[normalizedDrugQuery,drugOptions,drugOptionsIndexed])

const renderedRows=useMemo(()=>inventory.map(i=>(

<tr key={i.id} style={tableRow}>

<td style={tdDrug}>{i.drug_name}</td>
<td style={td}>{i.quantity}</td>
<td style={td}>{i.batch_no||"-"}</td>
<td style={td}>{i.expiry_date||"-"}</td>

</tr>

)),[inventory])

const handleDrugInputChange=useCallback((e)=>{
setDrug(e.target.value)
setShowDrugDropdown(true)
},[])

const handleDropdownSelect=useCallback((value)=>{
setDrug(value)
setShowDrugDropdown(false)
},[])

const applyDrugLookup=useCallback((row)=>{
if(!row){
setDrugCodeLookup(null)
setDrugCodeMessage("Drug code not found")
return
}

const displayName=[row.brand_name,row.strength,row.dosage_form]
.filter(Boolean)
.join(" ")

setDrugCodeLookup(row)
setDrugCodeMessage("")
setDrugCode(row.drug_code||"")
if(displayName)setDrug(displayName)
if(row.barcode)setBarcode(row.barcode)
if(row.pharmacy_price!==undefined&&row.pharmacy_price!==null&&row.pharmacy_price!==""){
setCost(String(row.pharmacy_price))
}
},[])

const handleDrugCodeChange=useCallback((e)=>{
setDrugCode(e.target.value)
setShowDrugCodeDropdown(true)
setDrugCodeMessage("")
},[])

const selectDrugCodeResult=useCallback((row)=>{
applyDrugLookup(row)
setDrugCodeResults([])
setShowDrugCodeDropdown(false)
},[applyDrugLookup])

const handleDrugCodeBlur=useCallback(()=>{
window.setTimeout(async()=>{
const code=normalizedDrugCodeQuery
if(!code){
setShowDrugCodeDropdown(false)
setDrugCodeMessage("")
return
}

try{
const row=await getDrugByCode(code)
if(row){
applyDrugLookup(row)
}else{
setDrugCodeLookup(null)
setDrugCodeMessage("Drug code not found")
}
}catch{
setDrugCodeMessage("Drug code not found")
}

setShowDrugCodeDropdown(false)
},120)
},[applyDrugLookup,normalizedDrugCodeQuery])

useEffect(()=>{
const timer=window.setTimeout(()=>{
setDebouncedDrugCode(normalizedDrugCodeQuery)
},180)

return()=>window.clearTimeout(timer)
},[normalizedDrugCodeQuery])

useEffect(()=>{
let canceled=false

if(!debouncedDrugCode||debouncedDrugCode.length<2){
setDrugCodeResults([])
return
}

const run=async()=>{
try{
const rows=await searchDrugs(debouncedDrugCode)
if(!canceled)setDrugCodeResults(rows||[])
}catch{
if(!canceled)setDrugCodeResults([])
}
}

void run()

return()=>{
canceled=true
}
},[debouncedDrugCode])

async function addInventory(e){

e.preventDefault()

setError("")
setSuccess("")

if(!drug){

setError("Drug required")
return

}

const unitsPerPack = extractUnits(package_size);
const quantity = parseFloat(qty) * unitsPerPack;if(!quantity||quantity<=0){

setError("Quantity invalid")
return

}

const payload={

pharmacy_id:selectedPharmacyId,
drug_name:drug,
quantity:quantity,
batch_no:batch||null,
expiry_date:expiry||null,
barcode:barcode||null,
unit_cost:cost?parseFloat(cost):0

}

const {error}=await supabase
.from("pharmacy_inventory")
.insert([payload])

if(error){

setError(error.message)
return

}

setSuccess("Inventory added")

setDrug("")
setDrugCode("")
setQty("")
setBatch("")
setCost("")
setBarcode("")
setExpiry("")
setDrugCodeLookup(null)
setDrugCodeMessage("")

loadInventory()

}

return(

<div style={pageShell}>

<div style={pageWrap}>

<div style={headerCard}>

<div style={eyebrow}>Operations</div>

<h2 style={title}>Inventory Management</h2>

<p style={subtitle}>Manage pharmacy inventory entries with clear operational controls.</p>

</div>

{error&&<div style={alertError}>{error}</div>}
{success&&<div style={alertSuccess}>{success}</div>}

<div style={contentCard}>

<div style={sectionTitle}>Add Inventory</div>

<form onSubmit={addInventory} style={formGrid}>

<div style={{position:"relative"}}>

<input
placeholder="Drug Code"
value={drugCode}
onChange={handleDrugCodeChange}
onFocus={()=>setShowDrugCodeDropdown(true)}
onBlur={handleDrugCodeBlur}
style={inputStyle}
/>

{showDrugCodeDropdown&&drugCode&&drugCodeResults.length>0?(
<div style={dropdown}>
{drugCodeResults.map(row=>(
<div
key={`${row.drug_code||"no-code"}-${row.brand_name||"no-name"}`}
style={dropdownItem}
onMouseDown={()=>selectDrugCodeResult(row)}
>
{row.drug_code||"-"} • {row.brand_name||row.generic_name||"Unnamed drug"}
</div>
))}
</div>
):null}

</div>

<select
value={selectedPharmacyId}
onChange={e=>setSelectedPharmacyId(e.target.value)}
style={inputStyle}
>

<option value="">Select Pharmacy</option>

{pharmacies.map(p=>(

<option key={p.id} value={p.id}>
{p.name}
</option>

))}

</select>

<div style={{position:"relative"}}>

<input
placeholder="Search drug"
value={drug}
onChange={handleDrugInputChange}
onFocus={()=>setShowDrugDropdown(true)}
style={inputStyle}
/>

{showDrugDropdown&&drug&&(

<div style={dropdown}>

{filteredDrugs.map(d=>(

<div
key={d}
style={dropdownItem}
onMouseDown={()=>{
handleDropdownSelect(d)

}}
>

{d}

</div>

))}

</div>

)}

</div>

<input
placeholder="Quantity (UNIT)"
value={qty}
onChange={e=>setQty(e.target.value)}
style={inputStyle}
/>

<input
placeholder="Batch"
value={batch}
onChange={e=>setBatch(e.target.value)}
style={inputStyle}
/>

<input
placeholder="Expiry"
type="date"
value={expiry}
onChange={e=>setExpiry(e.target.value)}
style={inputStyle}
/>

<input
placeholder="Cost"
value={cost}
onChange={e=>setCost(e.target.value)}
style={inputStyle}
/>

<button type="submit" style={primaryButton}>

Add Inventory

</button>

</form>

{drugCodeMessage?<div style={alertError}>{drugCodeMessage}</div>:null}

{drugCodeLookup?(
<div style={lookupCard}>
<div style={lookupTitle}>{drugCodeLookup.brand_name||drugCodeLookup.generic_name||"Unnamed drug"}</div>
<div style={lookupGrid}>
<div><strong>Code:</strong> {drugCodeLookup.drug_code||"-"}</div>
<div><strong>Generic:</strong> {drugCodeLookup.generic_name||"-"}</div>
<div><strong>Strength:</strong> {drugCodeLookup.strength||"-"}</div>
<div><strong>Dosage:</strong> {drugCodeLookup.dosage_form||"-"}</div>
<div><strong>Pack:</strong> {drugCodeLookup.package_size||"-"}</div>
<div><strong>Pharmacy Price:</strong> {drugCodeLookup.pharmacy_price??"-"}</div>
<div><strong>Public Price:</strong> {drugCodeLookup.public_price??"-"}</div>
</div>
</div>
):null}

</div>

<div style={contentCard}>

<div style={tableHeaderRow}>

<div style={sectionTitle}>Inventory Records</div>

<div style={tableMeta}>{loading?"Loading...":`${inventory.length} rows`}</div>

</div>

<div style={tableWrap}>

<table style={table}>

<thead style={thead}>

<tr>

<th style={th}>Drug</th>
<th style={th}>Quantity</th>
<th style={th}>Batch</th>
<th style={th}>Expiry</th>

</tr>

</thead>

<tbody>

{renderedRows}

</tbody>

</table>

</div>

</div>

</div>

</div>

)

}

const dropdown={

position:"absolute",
background:"#fff",
border:"1px solid #dde6f1",
borderRadius:10,
width:"100%",
maxHeight:220,
overflowY:"auto",
zIndex:20,
boxShadow:"0 10px 20px rgba(15, 23, 42, 0.08)"

}

const dropdownItem={

padding:"10px 12px",
cursor:"pointer",
borderBottom:"1px solid #edf2f7",
fontSize:13,
color:"#0f172a"

}

const pageShell={

background:"#f5f7fb",
padding:"8px 2px 20px"

}

const pageWrap={

display:"grid",
gap:16,
maxWidth:1160,
margin:"0 auto"

}

const headerCard={

background:"linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
border:"1px solid #e4ebf4",
borderRadius:16,
padding:"20px 22px",
boxShadow:"0 10px 20px rgba(15, 23, 42, 0.05)"

}

const eyebrow={

fontSize:10,
letterSpacing:"0.1em",
textTransform:"uppercase",
fontWeight:700,
color:"#5b6c83",
marginBottom:8

}

const title={

margin:0,
fontSize:30,
lineHeight:1.2,
letterSpacing:"-0.02em",
color:"#0b1220"

}

const subtitle={

margin:"10px 0 0",
fontSize:14,
lineHeight:1.55,
color:"#4e5f77"

}

const alert={

borderRadius:10,
padding:"10px 12px",
fontSize:13,
fontWeight:600,
border:"1px solid transparent",
color:"#0f172a",
background:"#f8fafc"

}

const alertError={

...alert,
color:"#991b1b",
background:"#fef2f2",
border:"1px solid #fecaca"

}

const alertSuccess={

...alert,
color:"#065f46",
background:"#ecfdf5",
border:"1px solid #a7f3d0"

}

const contentCard={

background:"#ffffff",
border:"1px solid #e4ebf4",
borderRadius:14,
padding:"16px 16px 14px",
boxShadow:"0 6px 16px rgba(15, 23, 42, 0.04)"

}

const sectionTitle={

fontSize:17,
fontWeight:700,
color:"#0f172a",
marginBottom:14,
letterSpacing:"-0.01em"

}

const formGrid={

display:"grid",
gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",
gap:12,
marginBottom:4

}

const inputStyle={

width:"100%",
minHeight:40,
padding:"9px 11px",
borderRadius:10,
border:"1px solid #d4deec",
background:"#ffffff",
color:"#0f172a",
fontSize:13,
boxSizing:"border-box",
boxShadow:"0 1px 2px rgba(15, 23, 42, 0.03)"

}

const primaryButton={

border:"none",
borderRadius:10,
padding:"10px 14px",
minHeight:40,
background:"linear-gradient(135deg, #1f4ec9 0%, #2563eb 100%)",
color:"#ffffff",
fontWeight:700,
fontSize:13,
cursor:"pointer",
boxShadow:"0 8px 14px rgba(37, 99, 235, 0.2)"

}

const tableHeaderRow={

display:"flex",
justifyContent:"space-between",
alignItems:"center",
gap:12,
marginBottom:10

}

const tableMeta={

fontSize:12,
fontWeight:600,
color:"#5f6b7d"

}

const tableWrap={

border:"1px solid #e6edf5",
borderRadius:12,
overflowX:"auto",
background:"#fff"

}

const table={

width:"100%",
borderCollapse:"separate",
borderSpacing:0,
minWidth:640

}

const thead={

background:"#f8fbff"

}

const th={

textAlign:"left",
fontSize:11,
fontWeight:700,
letterSpacing:"0.06em",
textTransform:"uppercase",
color:"#5a6b82",
padding:"11px 12px",
borderBottom:"1px solid #dfe7f2",
whiteSpace:"nowrap"

}

const td={

fontSize:13,
color:"#0f172a",
padding:"11px 12px",
borderBottom:"1px solid #edf2f8",
lineHeight:1.45

}

const tdDrug={

...td,
minWidth:260,
whiteSpace:"normal",
wordBreak:"break-word"

}

const tableRow={

background:"#ffffff"

}

const lookupCard={

marginTop:10,
border:"1px solid #dce7f4",
borderRadius:12,
padding:"10px 12px",
background:"#f8fbff",
fontSize:13,
color:"#1e293b"

}

const lookupTitle={

fontWeight:700,
fontSize:14,
marginBottom:8,
color:"#0f172a"

}

const lookupGrid={

display:"grid",
gridTemplateColumns:"repeat(auto-fit, minmax(170px, 1fr))",
gap:7

}